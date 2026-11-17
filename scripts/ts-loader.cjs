const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

let registered = false;

function registerTsLoader() {
  if (registered) return;
  registered = true;

  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveWithAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const mapped = path.join(SRC_DIR, request.slice(2));
      return originalResolveFilename.call(this, mapped, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  const compileTs = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };

  require.extensions['.ts'] = compileTs;
  require.extensions['.tsx'] = compileTs;
}

module.exports = { registerTsLoader, ROOT };
