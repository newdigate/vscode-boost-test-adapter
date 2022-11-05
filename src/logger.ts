import * as vscode from 'vscode';

export class MyLogger {
	private outputChannel: vscode.OutputChannel;
	constructor(channelName: string) {
		this.outputChannel = vscode.window.createOutputChannel(channelName);
	}
	show() {
		this.outputChannel.show(true);
	}
	test(message: string) {
		this.outputChannel.appendLine(`Test: ${message}`);
	}
	info(message: string, showUi?: boolean) {
		this.outputChannel.appendLine(`Info: ${message}`);
		if (showUi) {
			vscode.window.showInformationMessage(`${message}`);
		}
	}
	warn(message: string, showUi?: boolean) {
		this.outputChannel.appendLine(`Warn: ${message}`);
		if (showUi) {
			vscode.window.showWarningMessage(`${message}`);
		}
	}
	error(message: string, showUi?: boolean) {
		this.outputChannel.appendLine(`Error: ${message}`);
		if (showUi) {
			vscode.window.showErrorMessage(`${message}`);
		}
	}
	exception(e: any, showUi?: boolean) {
		let message: string = "Exception: ";
		if (e instanceof Error) {
			message += `${e.name}, ${e.message}`;
		} else {
			message += typeof e;
		}
		this.outputChannel.appendLine(`Error: ${message}`);
		if (showUi) {
			vscode.window.showErrorMessage(`${message}`);
		}
	}
	dispose() {
		this.outputChannel.dispose();
	}
}
