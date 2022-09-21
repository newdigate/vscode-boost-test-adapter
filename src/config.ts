import * as vscode from 'vscode';
import * as logger from './logger';
import * as util from './util';
import { resolve } from 'path';

// IMPORTANT: Use the same name in package.json!
export const BoosTestAdapterConfig = "boost-test-adapter";

export interface TestExe {
    path: string;
    debugConfig?: string;
    envFile?: string;
    env?: Map<string, string>;
    cwd?: string;
    sourcePrefix?: string;
}

export interface TestConfig {
    testExes: TestExe[];
}

export async function getConfig(workspaceFolder: vscode.WorkspaceFolder, log: logger.MyLogger): Promise<TestConfig> {
    const testConfig: TestConfig = {
        testExes: []
    };

    const cfg = vscode.workspace.getConfiguration(BoosTestAdapterConfig);

    if (!cfg.has('tests')) {
        log.warn(`Settings: No ${BoosTestAdapterConfig}.tests found.`);
        return testConfig;
    }
    const cfgTests = cfg.get<Record<string, any>[]>('tests');
    if (!cfgTests) {
        return testConfig;
    }

    for (const cfgTest of cfgTests) {
        const testExe: TestExe = { path: "" };

        if (typeof cfgTest.testExecutable !== 'string') {
            log.error(`Settings: testExecutable must exist and it must be a string`);
            continue;
        }
        testExe.path = util.detokenizeVariables(cfgTest.testExecutable);

        if (typeof cfgTest.debugConfig !== 'undefined') {
            if (typeof cfgTest.debugConfig !== 'string') {
                log.error(`Settings: debugConfig must be a string`);
                continue;
            }
            testExe.debugConfig = cfgTest.debugConfig;
        }
        if (typeof cfgTest.cwd !== 'undefined') {
            if (typeof cfgTest.cwd !== 'string') {
                log.error(`Settings: cwd must be a string`);
                continue;
            }
            testExe.cwd = util.detokenizeVariables(cfgTest.cwd);
        }

        if (typeof cfgTest.sourcePrefix !== 'undefined') {
            if (typeof cfgTest.sourcePrefix !== 'string') {
                log.error(`Settings: sourcePrefix must be a string`);
                continue;
            }
            testExe.sourcePrefix = resolve(workspaceFolder.uri.fsPath, cfgTest.sourcePrefix);
        }

        if (typeof cfgTest.envFile !== 'undefined') {
            if (typeof cfgTest.envFile !== 'string') {
                log.error(`Settings: envFile must be a string`);
                continue;
            }
            testExe.envFile = util.detokenizeVariables(cfgTest.envFile);
        }

        if (typeof cfgTest.env !== 'undefined') {
            if (!(cfgTest.env instanceof Array)) {
                log.error(`Settings: env must be an array`);
                continue;
            }
            let testEnvMap = new Map<string, string>();
            for (const e of cfgTest.env) {
                const cfgEnvvar = e as Record<string, any>;
                if (typeof cfgEnvvar.name !== 'string') {
                    log.error(`Settings: Environment variable name must be a string`)
                    continue;
                }
                if (typeof cfgEnvvar.value !== 'string') {
                    log.error(`Settings: Environment variable value must be a string`)
                    continue;
                }
                testEnvMap.set(cfgEnvvar.name, cfgEnvvar.value);
            }
            testExe.env = testEnvMap;
        }

        testConfig.testExes.push(testExe);
    }

    return testConfig;
}
