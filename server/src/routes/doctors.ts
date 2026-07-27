import { Router } from 'express';
import { fetchDoctors } from '../db/queries';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const doctors = await fetchDoctors();
    res.json(doctors);
  } catch (err) {
    console.error('Failed to fetch doctors', err);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

export default router;

