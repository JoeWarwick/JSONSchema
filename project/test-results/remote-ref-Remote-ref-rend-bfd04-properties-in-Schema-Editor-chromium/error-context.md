# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: "[plugin:vite:esbuild] Transform failed with 1 error: C:/Users/JoeNuc/source/repos/JSONSchema-1/project/app/utils/schema-resolver.ts:399:0: ERROR: Expected \"finally\" but found \"export\""
  - generic [ref=e5]: C:/Users/JoeNuc/source/repos/JSONSchema-1/project/app/utils/schema-resolver.ts:399:0
  - generic [ref=e6]: "Expected \"finally\" but found \"export\" 397 | } 398 | 399 | export function resolveSchemaSync(schema: Record<string, unknown> | null): Record<string, unknown> | null { | ^ 400 | if (!schema || typeof schema !== 'object') return schema; 401 | try {"
  - generic [ref=e7]: at failureErrorWithLog (C:\Users\JoeNuc\source\repos\JSONSchema-1\project\node_modules\esbuild\lib\main.js:1467:15) at C:\Users\JoeNuc\source\repos\JSONSchema-1\project\node_modules\esbuild\lib\main.js:736:50 at responseCallbacks.<computed> (C:\Users\JoeNuc\source\repos\JSONSchema-1\project\node_modules\esbuild\lib\main.js:603:9) at handleIncomingPacket (C:\Users\JoeNuc\source\repos\JSONSchema-1\project\node_modules\esbuild\lib\main.js:658:12) at Socket.readFromStdout (C:\Users\JoeNuc\source\repos\JSONSchema-1\project\node_modules\esbuild\lib\main.js:581:7) at Socket.emit (node:events:518:28) at addChunk (node:internal/streams/readable:561:12) at readableAddChunkPushByteMode (node:internal/streams/readable:512:3) at Socket.Readable.push (node:internal/streams/readable:392:5) at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
  - generic [ref=e8]:
    - text: Click outside, press Esc key, or fix the code to dismiss.
    - text: You can also disable this overlay by setting
    - code [ref=e9]: server.hmr.overlay
    - text: to
    - code [ref=e10]: "false"
    - text: in
    - code [ref=e11]: vite.config.ts
    - text: .
```