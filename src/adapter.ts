import { Mutex } from 'async-mutex';
import { access, constants } from 'fs';
import { resolve } from 'path';
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
import { Log } from 'vscode-test-adapter-util';
import { BinaryError, TestExecutable } from './test-executable';
var path = require('path');
export class BoostTestAdapter implements TestAdapter {
	private readonly mutex: Mutex;
	private readonly disposables: { dispose(): void }[];
	private readonly testsEmitter: EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>;
	private readonly testStatesEmitter: EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>;
	private testExecutable?: TestExecutable;
	private watcher?: FileSystemWatcher;
	private currentTests?: TestSuiteInfo;

	constructor(readonly workspaceFolder: WorkspaceFolder, private readonly log: Log) {


		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('boost-test-adapter')) {
				try {
					this.watcher = undefined;
					this.updateSettings();
					this.load();
				} catch (err) {
					console.warn(err)
				}
			}
		});

		this.updateSettings();
		this.mutex = new Mutex();
		this.disposables = [];
		this.testsEmitter = new EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
		this.testStatesEmitter = new EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();


		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
	}

	updateSettings(): void {

		const settings = workspace.getConfiguration('boost-test-adapter');

		const executable = this.detokenizeVariables(settings.get<string>('testExecutable'));
		this.log.info(`test executable: ${executable}`)

		const sourcePrefix = this.detokenizeVariables(settings.get<string>('sourcePrefix'));
		this.log.info(`sourcePrefix: ${sourcePrefix}`)

		const cwd = this.detokenizeVariables(settings.get<string>('cwd'));
		this.log.info(`test executable current working directory: ${cwd}`)

		this.log.info(`executable = '${executable}', sourcePrefix = '${sourcePrefix}', cwd='${cwd}'`)

		this.testExecutable = executable
			? new TestExecutable(
				this.workspaceFolder,
				executable,
				cwd,
				sourcePrefix ? resolve(this.workspaceFolder.uri.fsPath, sourcePrefix) : undefined)
			: undefined;
		this.load();
	}

	get tests(): Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
		return this.testsEmitter.event;
	}

	get testStates(): Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> {
		return this.testStatesEmitter.event;
	}

	dispose() {
		this.cancel();

		for (const disposable of this.disposables) {
			disposable.dispose();
		}

		this.disposables.length = 0;
	}

	async load(): Promise<void> {
		if (!this.testExecutable) {
			this.log.info('No test executable is provided in the configuration');
			return;
		}

		// load test cases
		const release = await this.mutex.acquire();

		try {
			this.testsEmitter.fire({type: 'started'});

			try {
				this.currentTests = await this.testExecutable.listTest();
			} catch (e) {
				if (!(e instanceof BinaryError && e.cause.code === 'ENOENT')) {
					this.log.error(e);
				}

				this.currentTests = undefined;
			}

			this.testsEmitter.fire({type: 'finished', suite: this.currentTests});
		} finally {
			release();
		}

		// start watching test binary
		if (!this.watcher) {
			this.watcher = workspace.createFileSystemWatcher(
				new RelativePattern(this.workspaceFolder, this.testExecutable.path));

			try {
				const load = (e: Uri) => {
					return new Promise<void>((resolve, reject) => access(e.fsPath, constants.X_OK, async (e: any) => {
						if (!e) {
							try {
								await this.load();
							} catch (e) {
								reject(e);
								return;
							}
						}
						resolve();
					}));
				};

				this.watcher.onDidChange(load);
				this.watcher.onDidCreate(load);
				this.watcher.onDidDelete(() => this.load());

				this.disposables.push(this.watcher);
			} catch (e) {
				this.log.error(e);
				this.watcher.dispose();
			}
		}
	}

	async run(tests: string[]): Promise<void> {
		const all = tests.length === 1 && tests[0] === this.currentTests!.id;

		const release = await this.mutex.acquire();

		try {
			this.testStatesEmitter.fire({type: 'started', tests});

			try {
				await this.testExecutable!.runTests(all ? undefined : tests, e => {
					this.testStatesEmitter.fire(e);
				}, this.log);
			} catch (e) {
				this.log.error(e);
			}

			this.testStatesEmitter.fire({type: 'finished'});
		} finally {
			release();
		}
	}

	async debug?(tests: string[]): Promise<void> {
		let args: String[] = [];
		const ids = tests.join(',');
		if (ids) {
			args = [`--run_test=${ids}`];
		}
		const path = resolve(this.workspaceFolder.uri.fsPath, this.testExecutable!.path);
		const debugConfiguration: vscode.DebugConfiguration = {
			name: "(lldb) Launch test cmake",
			type: "cppdbg",
			request: "launch",
			cwd: this.testExecutable?.cwd,
			program: path,
			linux: {
				MIMode: "gdb",
			},
			osx: {
				MIMode: "lldb"
			},
			windows: {
				MIMode: "gdb",
			},
			args: args,
			outputCapture: "std"
		};
		this.log.info(`${JSON.stringify(debugConfiguration)} workspaceFolder=${this.testExecutable?.workspaceFolder.uri.fsPath} cwd=${this.testExecutable?.cwd}`)
		await vscode.debug.startDebugging(undefined, debugConfiguration);
	}

	cancel() {
        if (!this.testExecutable) {
            this.log.info('No test executable is provided in the configuration');
            return;
        }
        this.testExecutable.stop();
	}

	// detokenizeVariables is based on https://github.com/DominicVonk/vscode-variables
	detokenizeVariables(rawValue: string | undefined, recursive = false): string | undefined {
		if (rawValue == undefined) {
			return undefined;
		}

		let workspaces = vscode.workspace.workspaceFolders;
		let workspace = vscode.workspace.workspaceFolders?.length ? vscode.workspace.workspaceFolders[0] : null;
		let activeFile = vscode.window.activeTextEditor?.document;
		let absoluteFilePath = activeFile?.uri.fsPath
		rawValue = rawValue?.replace(/\${workspaceFolder}/g, workspace?.uri.fsPath ?? "");
		rawValue = rawValue?.replace(/\${workspaceFolderBasename}/g, workspace?.name ?? "");
		rawValue = rawValue?.replace(/\${file}/g, absoluteFilePath ?? "");
		let activeWorkspace = workspace;
		let relativeFilePath = absoluteFilePath;
		for (let workspace of workspaces ?? []) {
			if (absoluteFilePath?.replace(workspace.uri.fsPath, '') !== absoluteFilePath) {
				activeWorkspace = workspace;
				relativeFilePath = absoluteFilePath?.replace(workspace.uri.fsPath, '').substr(path.sep.length);
				break;
			}
		}
		rawValue = rawValue?.replace(/\${fileWorkspaceFolder}/g, activeWorkspace?.uri.fsPath ?? "");
		rawValue = rawValue?.replace(/\${relativeFile}/g, relativeFilePath ?? "");
		rawValue = rawValue?.replace(/\${relativeFileDirname}/g, relativeFilePath?.substr(0, relativeFilePath.lastIndexOf(path.sep)) ?? "");
		let parsedPath = absoluteFilePath ? path.parse(absoluteFilePath) : undefined;
		rawValue = rawValue?.replace(/\${fileBasename}/g, parsedPath?.base ?? "");
		rawValue = rawValue?.replace(/\${fileBasenameNoExtension}/g, parsedPath?.name ?? "");
		rawValue = rawValue?.replace(/\${fileExtname}/g, parsedPath?.ext ?? "");
		rawValue = rawValue?.replace(/\${fileDirname}/g, parsedPath?.dir?.substr(parsedPath?.dir?.lastIndexOf(path.sep) + 1) ?? "");
		rawValue = rawValue?.replace(/\${cwd}/g, parsedPath?.dir ?? "");
		rawValue = rawValue?.replace(/\${pathSeparator}/g, path.sep);
		return rawValue;
	}
}