import * as vscode from 'vscode';
var path = require('path');

// detokenizeVariables is based on https://github.com/DominicVonk/vscode-variables
export function detokenizeVariables(rawValue: string, recursive = false): string {
    let workspaces = vscode.workspace.workspaceFolders;
    let workspace = vscode.workspace.workspaceFolders?.length ? vscode.workspace.workspaceFolders[0] : null;
    let activeFile = vscode.window.activeTextEditor?.document;
    let absoluteFilePath = activeFile?.uri.fsPath
    rawValue = rawValue.replace(/\${workspaceFolder}/g, workspace?.uri.fsPath ?? "");
    rawValue = rawValue.replace(/\${workspaceFolderBasename}/g, workspace?.name ?? "");
    rawValue = rawValue.replace(/\${file}/g, absoluteFilePath ?? "");
    let activeWorkspace = workspace;
    let relativeFilePath = absoluteFilePath;
    for (let workspace of workspaces ?? []) {
        if (absoluteFilePath?.replace(workspace.uri.fsPath, '') !== absoluteFilePath) {
            activeWorkspace = workspace;
            relativeFilePath = absoluteFilePath?.replace(workspace.uri.fsPath, '').substr(path.sep.length);
            break;
        }
    }
    let parsedPath = path.parse(absoluteFilePath);
    rawValue = rawValue.replace(/\${fileWorkspaceFolder}/g, activeWorkspace?.uri.fsPath ?? "");
    rawValue = rawValue.replace(/\${relativeFile}/g, relativeFilePath ?? "");
    rawValue = rawValue.replace(/\${relativeFileDirname}/g, relativeFilePath?.substr(0, relativeFilePath.lastIndexOf(path.sep)) ?? "");
    rawValue = rawValue.replace(/\${fileBasename}/g, parsedPath.base ?? "");
    rawValue = rawValue.replace(/\${fileBasenameNoExtension}/g, parsedPath.name ?? "");
    rawValue = rawValue.replace(/\${fileExtname}/g, parsedPath.ext ?? "");
    rawValue = rawValue.replace(/\${fileDirname}/g, parsedPath.dir.substr(parsedPath.dir.lastIndexOf(path.sep) + 1));
    rawValue = rawValue.replace(/\${cwd}/g, parsedPath.dir);
    rawValue = rawValue.replace(/\${pathSeparator}/g, path.sep);
    return rawValue;
}
