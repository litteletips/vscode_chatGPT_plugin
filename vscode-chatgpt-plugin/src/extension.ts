import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {

    let generateCodeDisposable = vscode.commands.registerCommand('chatgpt-extension.openEditor', () => {
        const panel = vscode.window.createWebviewPanel(
            'codeGenerator',
            'ChatGPT Code Generator',
            vscode.ViewColumn.One,
            {}
        );
    
        panel.webview.html = getWebviewContent(context.extensionPath);
    
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'generateCode') {
                const codeRequest = message.codeRequest;
                const temperature = message.temperature;
                const response = await callGPT4Api(codeRequest, temperature, '');
    
                // コードを生成して、現在のエディタに挿入
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const insertPosition = editor.selection.active;
                    editor.edit((editBuilder) => {
                        editBuilder.insert(insertPosition, response);
                    });
                }
            }
        }, undefined, context.subscriptions);
    });

    let findBugsDisposable = vscode.commands.registerCommand('chatgpt-extension.findBugs', () => {
        showResultPanel('findBugs');
    });
    context.subscriptions.push(findBugsDisposable);
    
    let optimizeDisposable = vscode.commands.registerCommand('chatgpt-extension.optimize', () => {
        showResultPanel('optimize');
    });
    context.subscriptions.push(optimizeDisposable);
    
    let explainDisposable = vscode.commands.registerCommand('chatgpt-extension.explain', () => {
        showResultPanel('explain');
    });
    context.subscriptions.push(explainDisposable);
    
    let addCommentsDisposable = vscode.commands.registerCommand('chatgpt-extension.addComments', () => {
        showResultPanel('addComments');
    });
    context.subscriptions.push(addCommentsDisposable);

    let addTestsDisposable = vscode.commands.registerCommand('chatgpt-extension.addTests', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
    
        const selectedCode = editor.document.getText(editor.selection);
        if (!selectedCode) {
            return;
        }
    
        const panel = vscode.window.createWebviewPanel(
            'addTests',
            'Add Tests',
            vscode.ViewColumn.One,
            {}
        );
    
        panel.webview.html = getWebviewContent(context.extensionPath);
    
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'askQuestion') {
                const question = `Generate test code for the following code:\n${selectedCode}`;
                const response = await callGPT4Api(question, 0.5, '');
    
                // テストコードを生成して、現在のエディタに挿入
                const insertPosition = editor.selection.active;
                editor.edit((editBuilder) => {
                    editBuilder.insert(insertPosition, response);
                });
    
                // 出力と質問入力欄を表示
                panel.webview.html = `
                    <html>
                        <body>
                            <h1>Test Code Result</h1>
                            <pre>${response}</pre>
                            <p>Enter your question:</p>
                            <input type="text" id="question">
                            <br>
                            <button id="ask">Ask</button>
                            <script>
                                const vscode = acquireVsCodeApi();
    
                                document.getElementById('ask').addEventListener('click', () => {
                                    const question = document.getElementById('question').value;
                                    vscode.postMessage({
                                        type: 'askQuestion',
                                        question
                                    });
                                });
                            </script>
                        </body>
                    </html>`;
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(addTestsDisposable);

    async function showResultPanel(actionType: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
    
            const response = await callGPT4Api(selectedText, 0.5, actionType);
    
            const panel = vscode.window.createWebviewPanel(
                'codeResult',
                'Code Result',
                vscode.ViewColumn.One
            );
    
            panel.webview.html = `
                <html>
                    <body>
                        <h1>Code Result</h1>
                        <pre>${response}</pre>
                        <p>Enter your question:</p>
                        <input type="text" id="question">
                        <br>
                        <button id="ask">Ask</button>
                        <script>
                            const vscode = acquireVsCodeApi();
    
                            document.getElementById('ask').addEventListener('click', () => {
                                const question = document.getElementById('question').value;
                                vscode.postMessage({
                                    type: 'askQuestion',
                                    question
                                });
                            });
                        </script>
                    </body>
                </html>`;
            
            panel.webview.onDidReceiveMessage(async (message) => {
                if (message.type === 'askQuestion') {
                    const question = message.question;
                    const response = await callGPT4Api(question, 0.5, '');
    
                    panel.webview.html = `
                        <html>
                            <body>
                                <h1>Code Result</h1>
                                <pre>${response}</pre>
                                <p>Enter your question:</p>
                                <input type="text" id="question" value="${question}">
                                <br>
                                <button id="ask">Ask</button>
                                <script>
                                    const vscode = acquireVsCodeApi();
    
                                    document.getElementById('ask').addEventListener('click', () => {
                                        const question = document.getElementById('question').value;
                                        vscode.postMessage({
                                            type: 'askQuestion',
                                            question
                                        });
                                    });
                                </script>
                            </body>
                        </html>`;
                }
            }, undefined, context.subscriptions);
        }
    }
    
    context.subscriptions.push(generateCodeDisposable);

}

// actionType: 'findBugs' | 'optimize' | 'explain' | 'addComments'
async function callGPT4Api(prompt: string, temperature: number, actionType: string): Promise<string> {

    const config = vscode.workspace.getConfiguration('gpt4Extension');
    const apiKey = config.get('apiKey');
    const model = config.get('model');
    let systemPrompt = "You are an experienced and super talented engineer!\n";
    let prefix = "";
    switch (actionType) {
        case 'findBugs':
            prefix = "What are the problems with this code?";
            break;
        case 'optimize':
            prefix = "How can I optimize this code for better readability and performance?";
            break;
        case 'explain':
            prefix = "Please explain the following code line by line:";
            break;
        case 'addComments':
            prefix = "Please add comments to the following code to improve its readability:";
            break;
    }

    let userPrompt = `${prefix}\n${prompt}`;

    const endpoint = 'https://api.openai.com/v1/chat/completions';
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
    };
    const messages = [
        {
            role: "system",
            content: systemPrompt,
        },
        {
            role: "user",
            content: userPrompt,
        },
    ];
    const data = JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 2000,
        temperature
    });

    try {
        const response = await axios.post(endpoint, data, { headers });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error(error);
        return 'Error: API call failed';
    }
}

function getWebviewContent(extensionPath: string): string {
    const webviewPath = path.join(extensionPath, 'webview.html');
    return fs.readFileSync(webviewPath, 'utf8');
}

// This method is called when your extension is deactivated
export function deactivate() {}
