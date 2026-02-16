import * as vscode from 'vscode';
import { QuotaService } from './services/QuotaService';
import { StatusBarManager } from './ui/StatusBarManager';
import { MenuManager } from './ui/MenuManager';

let log: vscode.OutputChannel;
let quotaService: QuotaService;
let statusBarManager: StatusBarManager;
let menuManager: MenuManager;

export function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("Antigravity Quotas");
    log.appendLine("Extension activated.");

    // Initialize Services
    quotaService = new QuotaService(log);

    // Initialize UI Managers
    statusBarManager = new StatusBarManager(quotaService, context);
    menuManager = new MenuManager(quotaService);

    // Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quotas.refresh', async () => {
        log.appendLine("Manual refresh requested.");
        await quotaService.refresh();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quotas.show', () => {
        log.appendLine("Show quotas menu command executed.");
        menuManager.showMenu();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-quotas.setNickname', () => {
        menuManager.showNicknamePicker();
    }));

    // Initial refresh
    quotaService.refresh();

    // Store references to dispose effectively if needed, though context.subscriptions handles most
    context.subscriptions.push(log);
    context.subscriptions.push({ dispose: () => statusBarManager.dispose() });
}

export function deactivate() { }
