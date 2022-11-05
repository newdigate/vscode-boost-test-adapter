import { Mutex } from 'async-mutex';
import * as vscode from "vscode";
import { Event, EventEmitter, FileSystemWatcher, RelativePattern, workspace, WorkspaceFolder, Uri } from 'vscode';
import {
    TestAdapter,
    TestEvent,
    TestLoadFinishedEvent,
    TestLoadStartedEvent,
    TestRunFinishedEvent,
    TestRunStartedEvent,
    TestSuiteEvent,
    TestSuiteInfo
} from 'vscode-test-adapter-api';
import * as logger from './logger';
import { TestExecutable } from './test-executable';
import * as config from './config';

export class BoostTestAdapter implements TestAdapter {
    private readonly rootTestId = "R##T";
    private readonly mutex: Mutex = new Mutex();
    private readonly disposables: { dispose(): void }[] = [];
    private readonly testsEmitter: EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>;
    private readonly testStatesEmitter: EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>;
    private testExecutables: Map<string, TestExecutable> = new Map();
    private watchers: Map<string, FileSystemWatcher> = new Map();
    private currentTests: Map<string, TestSuiteInfo> = new Map();

    constructor(
        readonly workspaceFolder: WorkspaceFolder,
        private readonly log: logger.MyLogger) {

        log.info("Initializing adapter.");
        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration(config.BoosTestAdapterConfig)) {
                try {
                    this.log.info("Configuration changed. Reloading tests.")
                    await this.reload();
                } catch (err) {
                    console.warn(err)
                }
            }
        });

        this.testsEmitter = new EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
        this.testStatesEmitter = new EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();

        this.disposables.push(this.testsEmitter);
        this.disposables.push(this.testStatesEmitter);
    }

    async reload(): Promise<void> {
        await this.updateSettings();
        await this.load();
    }

    private async updateSettings(): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.updateSettingsUnlocked();
        } finally {
            release();
        }
    }

    private async updateSettingsUnlocked(): Promise<void> {
        this.clearWatchers();
        this.currentTests.clear();
        this.testExecutables.clear();
        //this.testsEmitter.fire({ type: 'started' });
        //this.testsEmitter.fire({ type: 'finished', suite: this.createRootTestSuiteInfo() });

        const cfg = await config.getConfig(this.workspaceFolder, this.log);

        for (const cfgTestExe of cfg.testExes) {
            const testExeId = this.createTestExeId(cfgTestExe.path);
            this.testExecutables.set(testExeId, new TestExecutable(
                testExeId,
                this.workspaceFolder,
                cfgTestExe,
                this.log));
        }
    }

    get tests(): Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
        return this.testsEmitter.event;
    }

    get testStates(): Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> {
        return this.testStatesEmitter.event;
    }

    dispose() {
        this.cancel();
        this.clearWatchers();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    async load(): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.loadUnlocked();
        } finally {
            release();
        }
    }

    async run(tests: string[]): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.runUnlocked(tests);
        } finally {
            release();
        }
    }

    async debug(tests: string[]): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.debugUnlocked(tests);
        } finally {
            release();
        }
    }

    cancel() {
        for (const [_, testExecutable] of this.testExecutables) {
            testExecutable.cancelTests(this.log);
        }
    }

    private async loadUnlocked(): Promise<void> {
        this.clearWatchers();
        this.currentTests.clear();

        if (this.testExecutables.size === 0) {
            await this.updateSettingsUnlocked();
            if (this.testExecutables.size === 0) {
                this.log.info('No valid test executables found. Cannot load tests.');
                this.testsEmitter.fire({ type: 'started' });
                this.testsEmitter.fire({ type: 'finished', suite: this.createRootTestSuiteInfo() });
                return;
            }
        }

        for (const [_, testExecutable] of this.testExecutables) {
            await this.loadOneUnlocked(testExecutable)
        }
    }

    private async runUnlocked(tests: string[]): Promise<void> {
        const testIds = this.resolveRootTestId(tests);
        const m = this.groupTestIdsByTestExeId(testIds);
        this.testStatesEmitter.fire({ type: 'started', tests });
        for (const [testExeId, testIds] of m) {
            try {
                await this.testExecutables.get(testExeId)!.runTests(
                    testIds,
                    e => this.testStatesEmitter.fire(e));
            } catch (e) {
                this.log.exception(e, true);
            }
        }
        this.testStatesEmitter.fire({ type: 'finished' });
    }

    private async debugUnlocked(tests: string[]): Promise<void> {
        const testIds = this.resolveRootTestId(tests);
        const m = this.groupTestIdsByTestExeId(testIds);
        if (m.size > 1) {
            this.log.error("Cannot debug multiple test executables at once", true);
            return;
        }

        const testExeId = this.getTestExeId(testIds[0]);
        const testExecutable = this.testExecutables.get(testExeId)!;
        await testExecutable.debugTests(tests, this.log);
    }

    private async loadOne(testExecutable: TestExecutable): Promise<void> {
        const release = await this.mutex.acquire();
        try {
            await this.loadOneUnlocked(testExecutable);
        } finally {
            release();
        }
    }

    private async loadOneUnlocked(testExecutable: TestExecutable): Promise<void> {
        const key = testExecutable.id;

        this.testsEmitter.fire({ type: 'started' });
        try {
            this.currentTests.set(key, await testExecutable.listTest());
        } catch (e) {
            this.log.exception(e);

            this.currentTests.set(key, <TestSuiteInfo>{
                type: 'suite',
                id: testExecutable.cfg.path,
                label: testExecutable.cfg.path,
                file: testExecutable.cfg.path,
                line: undefined,
                children: []
            });
        }
        this.testsEmitter.fire({ type: 'finished', suite: this.createRootTestSuiteInfo() });

        // start watching test binary
        if (!this.watchers.has(key)) {
            const watcher = workspace.createFileSystemWatcher(
                new RelativePattern(this.workspaceFolder, testExecutable.cfg.path));

            try {
                const load = async (e: Uri) => {
                    this.log.info(`Test executable has changed: ${testExecutable.cfg.path}`);
                    if (e.fsPath !== testExecutable.absPath) {
                        this.log.warn(`Paths don't match: ${e.fsPath} should be ${testExecutable.absPath}`);
                        return;
                    }
                    try {
                        await this.loadOne(testExecutable);
                    } catch (e) {
                        this.log.exception(e);
                    }
                };

                watcher.onDidChange(load);
                watcher.onDidCreate(load);
                watcher.onDidDelete(load);
                this.watchers.set(key, watcher);
            } catch (e) {
                this.log.exception(e);
                watcher.dispose();
            }
        }
    }

    private clearWatchers() {
        for (const [_, watcher] of this.watchers) {
            watcher.dispose();
        }
        this.watchers.clear();
    }

    private createRootTestSuiteInfo(): TestSuiteInfo {
        const testsRoot = <TestSuiteInfo>{
            type: 'suite',
            id: this.rootTestId,
            label: "ROOT",
            children: []
        };
        for (const [_, testSuiteInfo] of this.currentTests) {
            testsRoot.children.push(testSuiteInfo);
        }
        return testsRoot;
    }

    private createTestExeId(testExePath: string): string {
        const regex = /[\\/]/g;
        return testExePath.replace(regex, '_');
    }

    private getTestExeId(testId: string): string {
        return testId.split('/')[0];
    }

    // If the root test ID is present among the test IDs then
    // include all of the test-exe-ids into the list.
    // I.e. we want to include every test executable.
    private resolveRootTestId(testIds: string[]): string[] {
        const resolvedIds: string[] = [];
        for (const testId of testIds) {
            if (testId === this.rootTestId) {
                for (const [testExeId, _] of this.testExecutables) {
                    resolvedIds.push(testExeId);
                }
            } else {
                resolvedIds.push(testId);
            }
        }
        return resolvedIds;
    }

    // Groups the test IDs by their test-exe-id component.
    // The test IDs have this format:
    // "test-exe-id/suite-1/suite-2/.../test-case"
    private groupTestIdsByTestExeId(testIds: string[]): Map<string, string[]> {
        const m: Map<string, string[]> = new Map();
        for (const testId of testIds) {
            const testExeId = this.getTestExeId(testId);
            if (m.has(testExeId)) {
                m.get(testExeId)!.push(testId);
            } else {
                m.set(testExeId, [testId]);
            }
        }
        return m;
    }
}