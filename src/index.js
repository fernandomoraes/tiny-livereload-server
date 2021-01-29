#! /usr/bin/env node

const path = require('path');
const es = require('event-stream');

const http = require('http');
const WebSocket = require('ws');
const send = require('send');

const open = require('open');
const chokidar = require('chokidar');

const argv = require('minimist')(process.argv.slice(2));

const ws = new WebSocket.Server({ noServer: true });
const liveReloadWsConnections = [];
const SERVER_PORT = 3027;

const LIVERELOAD_INJECT_TAG = '</head>';

const cwd = argv.cwd ? `${process.cwd()}/${argv.cwd}` : process.cwd();

const LIVERELOAD_FRAGMENT = `
<script>
    const protocol = window.location.protocol === 'http:' ? 'ws' : 'wss';
    const address = \`\${protocol}://\${window.location.host}\${window.location.pathname}\`;

    const events = {
        reload: () => window.location.reload(),
        cssReload: () => document.querySelectorAll('link').forEach(link => link.href = link.href)
    };

    new WebSocket(address).onmessage = message => (events[message.data] || (() => {}))();
</script>
`;

const REPLACE_LIVERELOAD_FRAGMENT_REGEX = new RegExp(LIVERELOAD_INJECT_TAG, 'i');

startWatcher();
startServer();

function startWatcher() {
    const options = {
        ignored: ['node_modules/**/*', '.git/**/*'],
        ignoreInitial: true
    };

    const watcher = chokidar.watch(cwd, options);

    watcher.on('all', (event, pathFile) => {
        const isCss = path.extname(pathFile) === '.css';
        const message = isCss ? 'cssReload' : 'reload';
        liveReloadWsConnections.forEach((connection) => connection.send(message));
    });
}

function startServer() {
    const server = http.createServer((req, res) => {
        const safeRequestPath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(cwd, safeRequestPath);

        const injectLiveReload = ['', 'html'].indexOf(path.extname(filePath)) > -1;

        send(req, filePath)
            .on('stream', (stream) => {
                if (injectLiveReload) {
                    injectLiveReloadFragment(stream, res);
                }
            })
            .pipe(res);
    });

    server
        .addListener('upgrade', (req, socket, head) =>
            ws.handleUpgrade(req, socket, head, (connection) => liveReloadWsConnections.push(connection))
        )
        .addListener('listening', () => console.log(`server running on http://localhost:${SERVER_PORT} ...`))
        .addListener('listening', () => open(`http://localhost:${SERVER_PORT}`))
        .listen(SERVER_PORT);
}

function injectLiveReloadFragment(stream, res) {
    const newContentLength = res.getHeader('content-length') + LIVERELOAD_FRAGMENT.length;
    res.setHeader('content-length', newContentLength);

    const originalPipeStream = stream.pipe;

    stream.pipe = () => {
        originalPipeStream.call(
            stream, es.replace(REPLACE_LIVERELOAD_FRAGMENT_REGEX, `${LIVERELOAD_FRAGMENT}${LIVERELOAD_INJECT_TAG}`)
        ).pipe(res);
    };
}