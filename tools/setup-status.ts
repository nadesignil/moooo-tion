// A short-lived probe used by setup; output contains status only, never account details.
import {setupStatus} from '../server/setup';
try {console.log(JSON.stringify(await setupStatus())); process.exit(0);}
catch (error) {console.error((error as Error).message); process.exit(1);}
