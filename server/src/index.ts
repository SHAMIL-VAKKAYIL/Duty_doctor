import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool from './db/pool';
import rosterRouter from './routes/roster';


const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/roster', rosterRouter);


// Health check endpoint 
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, dbTime: result.rows[0].now });
  } catch (err) {
    console.error('Health check DB query failed', err);
    res.status(500).json({ ok: false, error: 'Database connection failed' });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

export default app;