import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '../css/style.css';

// Không dùng StrictMode: lõi cũ (js/app.js) khởi tạo đúng một lần sau khi React vẽ xong khung.
createRoot(document.getElementById('root')).render(<App />);

// Cache offline chỉ bật ở bản đã deploy (workflow chèn thẻ machsim-version)
if ('serviceWorker' in navigator && document.querySelector('meta[name="machsim-version"]')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
