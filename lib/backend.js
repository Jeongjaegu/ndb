/**
 * @license Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

const { rpc_process } = require('carlo/rpc');
const fs = require('fs');
const readline = require('readline');
const util = require('util');
const { URL } = require('url');
const { Readable } = require('stream');
const querystring = require('querystring');

const fsReadFile = util.promisify(fs.readFile);

class Backend {
  constructor(app) {
    this._app = app;
    this._handles = [];
  }

  async createService(fullName, ...args) {
    const handle = await rpc_process.spawn(fullName, {args: args});
    this._handles.push(handle);
    return handle;
  }

  bringToFront() {
    return this._app.mainWindow().bringToFront();
  }

  async loadSourceMap(sourceMapURL, compiledURL) {
    try {
      let payload;
      if (sourceMapURL.startsWith('data:')) {
        const [metadata, ...other] = sourceMapURL.split(',');
        const urlPayload = other.join(',');
        const isBase64 = metadata.endsWith(';base64');
        payload = JSON.parse(Buffer.from(isBase64 ? urlPayload : querystring.unescape(urlPayload), isBase64 ? 'base64' : 'utf8').toString('utf8'));
      } else {
        const fileURL = new URL(sourceMapURL);
        const content = await fsReadFile(fileURL, 'utf8');
        payload = JSON.parse(content);
      }
      await removeSourceContentIfMatch(sourceMapURL, compiledURL, payload);
      return {payload};
    } catch (e) {
      return {error: e.stack};
    }
  }

  dispose() {
    this._handles.splice(0).forEach(handle => handle.dispose());
  }
}

async function loadSourceMap(sourceMapURL, compiledURL) {
  try {
    let payload;
    if (sourceMapURL.startsWith('data:')) {
      const [metadata, ...other] = sourceMapURL.split(',');
      const urlPayload = other.join(',');
      const isBase64 = metadata.endsWith(';base64');
      payload = JSON.parse(Buffer.from(isBase64 ? urlPayload : querystring.unescape(urlPayload), isBase64 ? 'base64' : 'utf8').toString('utf8'));
    } else {
      const fileURL = new URL(sourceMapURL);
      const content = await fsReadFile(fileURL, 'utf8');
      payload = JSON.parse(content);
    }
    await removeSourceContentIfMatch(sourceMapURL, compiledURL, payload);
    return {payload};
  } catch (e) {
    return {error: e.stack};
  }
}

class StringStream extends Readable {
  constructor(str) {
    super();
    this._str = str;
    this._ended = false;
  }

  _read() {
    if (this._ended)
      return;
    this._ended = true;
    process.nextTick(_ => {
      this.push(Buffer.from(this._str, 'utf8'));
      this.push(null);
    });
  }
}

async function removeSourceContentIfMatch(sourceMapURL, compiledURL, payload) {
  const {sourcesContent, sources} = payload;
  if (!sourcesContent || !sources)
    return;
  for (let i = 0; i < sources.length; ++i) {
    if (!sources[i] || !sourcesContent[i]) continue;
    let url = sources[i];
    if (!path.isAbsolute(url))
      url = path.join(path.dirname(compiledURL), url);
    if (!fs.existsSync(url))
      continue;
    const sourceContentStream = new StringStream(sourcesContent[i]);
    const sourceContentLines = await readLines(sourceContentStream);
    const fileStream = fs.createReadStream(url);
    const fileStreamLines = await readLines(fileStream);
    if (sourceContentLines.length === fileStreamLines.length) {
      let equal = true;
      for (let i = 0; i < sourceContentLines.length; ++i) {
        if (sourceContentLines[i] !== fileStreamLines[i]) {
          equal = false;
          break;
        }
      }
      if (equal)
        sourcesContent[i] = undefined;
    }
  }
}

async function readLines(stream) {
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });
  return new Promise(resolve => {
    stream.once('error', _ => resolve(null));
    const lines = [];
    rl.on('line', line => lines.push(line));
    rl.on('close', _ => resolve(lines));
  });
}

module.exports = { Backend };
