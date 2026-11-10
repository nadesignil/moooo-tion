import {mkdirSync} from 'node:fs';
import {REMOTION_TEMP, RENDERS} from './paths';

// Process-local only: Node, FFmpeg and Chromium inherit the same workspace temp.
// Imported before the Remotion renderer/bundler. System environment is unchanged.
mkdirSync(REMOTION_TEMP,{recursive:true});
mkdirSync(RENDERS,{recursive:true});
process.env.TEMP = REMOTION_TEMP;
process.env.TMP = REMOTION_TEMP;
process.env.TMPDIR = REMOTION_TEMP;
