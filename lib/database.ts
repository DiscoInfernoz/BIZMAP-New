import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'jobs.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Create jobs table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT,
    name TEXT NOT NULL,
    service_date DATE NOT NULL,
    price REAL NOT NULL,
    service_type TEXT,
    lead_source TEXT,
    street TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    full_address TEXT,
    lat REAL,
    lng REAL,
    needs_geocode BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export interface Job {
  id: string;
  user_id?: string;
  name: string;
  service_date: string;
  price: number;
  service_type?: string;
  lead_source?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  full_address?: string;
  lat?: number;
  lng?: number;
  needs_geocode: boolean;
  created_at: string;
}

export interface ImportResult {
  total: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export function insertJobs(jobs: Omit<Job, 'id' | 'created_at'>[]): ImportResult {
  const result: ImportResult = {
    total: jobs.length,
    inserted: 0,
    skipped: 0,
    errors: []
  };

  const insertStmt = db.prepare(`
    INSERT INTO jobs (
      user_id, name, service_date, price, service_type, lead_source,
      street, city, state, zip, full_address, lat, lng, needs_geocode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((jobs: Omit<Job, 'id' | 'created_at'>[]) => {
    for (const job of jobs) {
      try {
        insertStmt.run(
          job.user_id || null,
          job.name,
          job.service_date,
          job.price,
          job.service_type || null,
          job.lead_source || null,
          job.street || null,
          job.city || null,
          job.state || null,
          job.zip || null,
          job.full_address || null,
          job.lat || null,
          job.lng || null,
          job.needs_geocode ? 1 : 0
        );
        result.inserted++;
      } catch (error) {
        result.errors.push(`Failed to insert job for ${job.name}: ${error}`);
      }
    }
  });

  try {
    insertMany(jobs);
  } catch (error) {
    result.errors.push(`Transaction failed: ${error}`);
  }

  return result;
}

export function getAllJobs(): Job[] {
  const stmt = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
  return stmt.all() as Job[];
}

export function getJobsNeedingGeocode(limit: number = 50): Job[] {
  const stmt = db.prepare(`
    SELECT * FROM jobs 
    WHERE (lat IS NULL OR lng IS NULL OR needs_geocode = 1) 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(limit) as Job[];
}

export function updateJobCoordinates(id: string, lat: number, lng: number, zip?: string): void {
  const stmt = db.prepare(`
    UPDATE jobs 
    SET lat = ?, lng = ?, zip = COALESCE(?, zip), needs_geocode = 0 
    WHERE id = ?
  `);
  stmt.run(lat, lng, zip || null, id);
}

export function countJobsNeedingGeocode(): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count 
    FROM jobs 
    WHERE (lat IS NULL OR lng IS NULL OR needs_geocode = 1)
  `);
  const result = stmt.get() as { count: number };
  return result.count;
}

export function getJobById(id: string): Job | undefined {
  const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  return stmt.get(id) as Job | undefined;
}

export default db;