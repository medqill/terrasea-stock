import { createApp } from './src/app.js';

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, '0.0.0.0', () => console.log(`terrasea-stock berjalan di http://localhost:${PORT}`));
