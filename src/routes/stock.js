import { Router } from 'express';
import * as data from '../data.js';
import { asyncHandler } from '../async-handler.js';

const r = Router();

r.get('/forecast/:zoneId', asyncHandler(async (req, res) => {
  if (!data.isZoneId(req.params.zoneId)) return res.status(400).json({ message: 'ID zona tidak valid.' });
  const f = await data.getForecast(req.params.zoneId);
  f ? res.json({ ...f.data, is_fixture: f.fixture }) : res.status(404).json({ message: 'Data prakiraan zona ini belum tersedia.' });
}));

export default r;
