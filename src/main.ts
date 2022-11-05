import * as vscode from 'vscode';
import { testExplorerExtensionId, TestHub } from 'vscode-test-adapter-api';
import { TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { BoostTestAdapter } from './adapter';
import * as logger from './logger';

export async function activate(context: vscode.ExtensionContext) {
    const log = new logger.MyLogger('Boost.Test Adapter');
    log.info("Extension activated.");

    context.subscriptions.push(log);

    // get the Test Explorer extension
    const testExplorer = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);

    if (testExplorer) {
        const testHub = testExplorer.exports;
        const registrar = new TestAdapterRegistrar(
            testHub,
            workspace => new BoostTestAdapter(workspace, log),
            undefined);

        context.subscriptions.push(registrar);
    } else {
        log.error("Cannot find the Test Explorer UI extensions.");
    }
}
