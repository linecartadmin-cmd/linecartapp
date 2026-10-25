import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If local data.js exists, load it; otherwise fall back to sanitized data.demo.js
const localDataPath = path.join(__dirname, 'data.js');
const demoDataPath = path.join(__dirname, 'data.demo.js');

const chosenPath = fs.existsSync(localDataPath) ? localDataPath : demoDataPath;
const mod = await import(pathToFileURL(chosenPath).href);

export const {
  salesPersons,
  clusters,
  defaultOrderItems,
  defaultSurveyItems,
  shops,
  clusterStats,
  submittedOrders,
  managerAssignments,
  salesTargets
} = mod;
