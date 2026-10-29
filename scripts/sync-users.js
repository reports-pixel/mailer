// Copies the office employee API (EMPLOYEE_API_URL) into Turso. Run on a PC inside the office network:
//   npm run sync-users
// The Windows service also does this automatically every hour.
import { migrate } from '../server/db.js';
import { syncFromApi } from '../server/employees.js';

await migrate();
const result = await syncFromApi();
console.log(`Imported ${result.imported} users into Turso (${result.withoutEmail} without a valid email).`);
