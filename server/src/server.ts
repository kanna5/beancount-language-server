import * as os from 'os'
import * as path from 'path'
import * as LSP from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { runExternalCommand } from './utils'
import { provideDiagnostics } from './diagnostics'
/**
 * The BashServer glues together the separate components to implement
 * the various parts of the Language Server Protocol.
 */
export default class BeancountServer {
    /**
     * Initialize the server based on a connection to the client and the protocols
     * initialization parameters.
     */
    public static async initialize(
        connection: LSP.Connection,
        params: LSP.InitializeParams,
    ): Promise<BeancountServer> {
        const opts = params.initializationOptions;
        const rootBeancountFile = opts['rootBeancountFile']
        if (rootBeancountFile == undefined) {
            throw new Error('Must include rootBeancountFile in Initiaize parameters')
        }
        return new BeancountServer(connection, params);
    }


    private documents: LSP.TextDocuments<TextDocument> = new LSP.TextDocuments(TextDocument)
    private connection: LSP.Connection
    private rootBeancountFile: string;

    private constructor(
        connection: LSP.Connection,
        params: LSP.InitializeParams
    ) {
        connection.console.log(`Initialize: ${params.initializationOptions}`)
        const opts = params.initializationOptions;

        this.rootBeancountFile = opts['rootBeancountFile'].replace("~", os.homedir)
        this.connection = connection
    }

    /**
     * Register handlers for the events from the Language Server Protocol that we
     * care about.
     */
    public register(connection: LSP.Connection): void {
        this.connection.console.log('******************************  registering')
        // The content of a text document has changed. This event is emitted
        // when the text document first opened or when its content has changed.
        this.documents.listen(this.connection)

        // Register all the handlers for the LSP events.
        connection.onDidSaveTextDocument(this.onDidSaveTextDocument.bind(this));
    }

    /**
     * The parts of the Language Server Protocol that we are currently supporting.
     */
    public capabilities(): LSP.ServerCapabilities {
        return {
            textDocumentSync: {
                openClose: true,
                change: LSP.TextDocumentSyncKind.Incremental,
                willSave: false,
                willSaveWaitUntil: false,
                save: {
                    includeText: false
                }
            },
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: [':'],
            },
            hoverProvider: false,
            documentHighlightProvider: false,
            definitionProvider: false,
            documentSymbolProvider: false,
            workspaceSymbolProvider: false,
            referencesProvider: false,
        }
    }

    private logRequest({
        request,
        params,
        word,
    }: {
        request: string
        params: LSP.ReferenceParams | LSP.TextDocumentPositionParams
        word?: string | null
    }) {
        const wordLog = word ? `"${word}"` : 'null'
        this.connection.console.log(
            `${request} ${params.position.line}:${params.position.character} word=${wordLog}`,
        )
    }

    private onDidSaveTextDocument(
        params: LSP.DidSaveTextDocumentParams
    ) {
        const beanCheckPy = path.join(__dirname, '../python/bean_check.py');
        const pyArgs = [beanCheckPy, this.rootBeancountFile]
        // TODO: Allow option to specify python path
        runExternalCommand(
            'python',
            pyArgs,
            (text?: string) => {
                if (text) {
                    const output = text.split('\n', 3);
                    const errors = output[0]
                    const flagged = output[1]
                    //this.connection.console.log(errors)
                    //this.connection.console.log("\n\n")
                    //this.connection.console.log(flagged)
                    const diagnostics = provideDiagnostics(errors, flagged);

                    for (const file of Object.keys(diagnostics)) {
                        const relative_folder = path.relative(
                            path.dirname(this.rootBeancountFile),
                            path.dirname(file)
                        );
                        this.connection.sendDiagnostics({
                            uri: 'file://' + relative_folder + path.sep + path.basename(file),
                            diagnostics: diagnostics[file]
                        });
                    }
                }
            },
            undefined,
            (str: string) => {
                this.connection.console.error(str)
            }
        );
    }

}

