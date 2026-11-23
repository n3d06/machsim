import { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';

// Khung giao diện do React dựng; các id/class giữ nguyên để lõi cũ (js/app.js) gắn vào.
// Các vùng lõi cũ tự điền nội dung (#palette, #props, #status, #exMenu, ...) nên để trống và không có state ở đó.
const K = ({ children }) => <kbd>{children}</kbd>;

function useOpen(key) {
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '0');
  useEffect(() => localStorage.setItem(key, open ? '1' : '0'), [key, open]);
  return [open, setOpen];
}

export default function App() {
  const [left, setLeft] = useOpen('machsim.ui.left');
  const [right, setRight] = useOpen('machsim.ui.right');

  useEffect(() => { import('./legacy.js'); }, []);

  return (
    <div className={'app' + (left ? '' : ' no-left') + (right ? '' : ' no-right')}>
      <header className="topbar">
        <button className={'icon-btn' + (left ? ' on' : '')} title="Ẩn/hiện bảng bên trái" aria-label="Ẩn/hiện bảng bên trái" aria-pressed={left} onClick={() => setLeft(!left)}><Icon n="PanelLeft" /></button>
        <div className="brand">
          <b>MachSim</b>
        </div>
        <nav className="tabs" aria-label="Chế độ">
          <button data-view="design" className="active">Thiết kế mạch</button>
          <button data-view="bb">Breadboard</button>
        </nav>
        <div className="tb-group design-only">
          <button id="btnNew" title="Mạch mới"><Icon n="FilePlus" /> Mới</button>
          <div className="dropdown">
            <button id="btnExamples" title="Mạch ví dụ">Ví dụ <Icon n="ChevronDown" size={14} /></button>
            <div className="menu" id="exMenu"></div>
          </div>
          <button id="btnOpen" title="Mở tệp mạch (.json)"><Icon n="FolderOpen" /> Mở</button>
          <button id="btnSave" title="Lưu mạch ra tệp (Ctrl+S)"><Icon n="Save" /> Lưu</button>
          <button id="btnShare" title="Sao chép liên kết chia sẻ mạch"><Icon n="Share2" /> Chia sẻ</button>
          <span className="sep"></span>
          <button id="btnUndo" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác"><Icon n="Undo2" /></button>
          <button id="btnRedo" title="Làm lại (Ctrl+Y)" aria-label="Làm lại"><Icon n="Redo2" /></button>
          <span className="sep"></span>
          <button id="btnRun" className="run" title="Chạy / tạm dừng (Space)"><Icon n="Pause" /> Tạm dừng</button>
          <button id="btnReset" title="Chạy lại từ t = 0"><Icon n="RotateCcw" /> Chạy lại</button>
          <label className="speed" title="Tốc độ mô phỏng: số giây thời gian mạch trong mỗi giây thực">
            <span>Tốc độ</span>
            <input type="range" id="speed" min="-6" max="1" step="0.05" />
            <span id="speedLbl" className="mono"></span>
          </label>
          <span id="simTime" className="mono">t = 0</span>
        </div>
        <div className="tb-right">
          <button id="btnSettings" className="icon-btn" title="Cài đặt mô phỏng" aria-label="Cài đặt"><Icon n="Settings" /></button>
          <button id="btnHelp" className="icon-btn" title="Hướng dẫn" aria-label="Hướng dẫn"><Icon n="CircleHelp" /></button>
          <button id="btnTheme" className="icon-btn" title="Đổi giao diện sáng/tối" aria-label="Đổi giao diện"><Icon n="SunMoon" /></button>
          <button className={'icon-btn' + (right ? ' on' : '')} title="Ẩn/hiện bảng thuộc tính" aria-label="Ẩn/hiện bảng thuộc tính" aria-pressed={right} onClick={() => setRight(!right)}><Icon n="PanelRight" /></button>
        </div>
      </header>

      <main id="designView" className="view">
        <aside id="palette" aria-label="Bảng linh kiện"></aside>
        <section id="stage">
          <canvas id="cv"></canvas>
          <div className="float-tools">
            <button id="toolSelect" title="Chọn / di chuyển (V)"><Icon n="MousePointer2" /> Chọn</button>
            <button id="toolWire" title="Vẽ dây (W)"><Icon n="Cable" /> Dây</button>
            <button id="toolRotate" title="Xoay (R)"><Icon n="RotateCw" /></button>
            <button id="toolDelete" title="Xóa (Delete)"><Icon n="Trash2" /></button>
            <span className="sep"></span>
            <button id="toolFlow" title="Đổi chiều hiển thị dòng điện">I Quy ước</button>
            <button id="toolArrows" title="Hiện mũi tên và giá trị dòng điện cho mọi linh kiện"><Icon n="ArrowRight" /> I</button>
            <span className="sep"></span>
            <button id="toolZoomOut" title="Thu nhỏ (-)"><Icon n="Minus" /></button>
            <button id="toolFit" title="Vừa khung (Home)"><Icon n="Maximize" /></button>
            <button id="toolZoomIn" title="Phóng to (+)"><Icon n="Plus" /></button>
          </div>
          <div id="status"></div>
          <div id="toast" role="status"></div>
        </section>
        <aside id="props" aria-label="Thuộc tính"></aside>
      </main>

      <section id="scopePanel">
        <div className="scope-head">
          <b>Dao động ký</b>
          <div id="scopeChips"></div>
          <label className="mini" title="Kênh 1 làm trục X, kênh 2 làm trục Y"><input type="checkbox" id="scopeXY" /> XY</label>
          <label className="mini">Khung thời gian <input type="text" id="scopeWin" size="6" /></label>
          <button id="scopeClear" className="mini-btn">Xóa kênh</button>
          <button id="scopeToggle" className="mini-btn" title="Thu gọn / mở rộng"><Icon n="ChevronDown" size={14} /></button>
        </div>
        <canvas id="scopeCv"></canvas>
      </section>

      <main id="bbView" className="view" hidden>
        <aside id="bbPalette" className="palette" aria-label="Linh kiện breadboard"></aside>
        <section id="bbStage" className="stage">
          <canvas id="bbCv"></canvas>
          <div className="float-tools">
            <div className="dropdown">
              <button id="bbExBtn">Ví dụ <Icon n="ChevronDown" size={14} /></button>
              <div className="menu" id="bbExMenu"></div>
            </div>
            <button id="bbUndo" title="Hoàn tác (Ctrl+Z)"><Icon n="Undo2" /></button>
            <button id="bbRot" title="Đảo chiều (R)"><Icon n="ArrowLeftRight" /></button>
            <button id="bbDel" title="Xóa (Delete)"><Icon n="Trash2" /></button>
            <button id="bbClear" title="Gỡ hết linh kiện"><Icon n="Eraser" /> Gỡ hết</button>
            <span className="sep"></span>
            <button id="bbRun" className="run"><Icon n="Pause" /> Tạm dừng</button>
            <button id="bbReset" title="Chạy lại từ t = 0"><Icon n="RotateCcw" /></button>
            <label className="speed" title="Tốc độ mô phỏng"><input type="range" id="bbSpeed" min="-6" max="1" step="0.05" /><span id="bbSpeedLbl" className="mono"></span></label>
            <span id="bbTime" className="mono">t = 0</span>
            <button id="bbFit" title="Vừa khung (Home)"><Icon n="Maximize" /></button>
          </div>
          <div id="bbStatus" className="status"></div>
        </section>
        <aside id="bbProps" className="props" aria-label="Thuộc tính"></aside>
      </main>

      <section id="bbScopePanel" className="scope-panel" hidden>
        <div className="scope-head"><b>Dao động ký</b><div id="bbChips" className="chips"></div></div>
        <canvas id="bbScopeCv"></canvas>
      </section>

      <input type="file" id="fileInput" accept=".json,application/json" hidden />

      <dialog id="dlgSettings">
        <form method="dialog">
          <h2>Cài đặt</h2>
          <label className="field"><span className="field-label">Bước thời gian mô phỏng</span><div className="num-wrap"><input id="setDt" type="text" /><span className="unit">s</span></div></label>
          <label className="field"><span className="field-label">Phương pháp tích phân</span>
            <select id="setMethod">
              <option value="be">Euler lùi (ổn định, khuyên dùng)</option>
              <option value="trap">Hình thang (chính xác hơn, có thể dao động số)</option>
            </select>
          </label>
          <label className="field field-check"><input type="checkbox" id="setDc" /><span className="field-label">Khởi động từ điểm làm việc DC (tụ đã nạp sẵn)</span></label>
          <label className="field field-check"><input type="checkbox" id="setValues" /><span className="field-label">Hiện giá trị linh kiện trên sơ đồ</span></label>
          <label className="field field-check"><input type="checkbox" id="setDots" /><span className="field-label">Hiện chấm dòng điện chạy</span></label>
          <label className="field"><span className="field-label">Chiều dòng điện hiển thị</span>
            <select id="setFlow">
              <option value="conv">Chiều quy ước (+ → −)</option>
              <option value="electron">Chiều chuyển động electron (− → +)</option>
            </select>
          </label>
          <label className="field field-check"><input type="checkbox" id="setArrows" /><span className="field-label">Hiện mũi tên &amp; giá trị dòng cho mọi linh kiện</span></label>
          <label className="field field-check"><input type="checkbox" id="setAnsi" /><span className="field-label">Ký hiệu điện trở kiểu ANSI (răng cưa)</span></label>
          <label className="field"><span className="field-label">Giao diện</span>
            <select id="setTheme"><option value="auto">Theo hệ thống</option><option value="dark">Tối</option><option value="light">Sáng</option></select>
          </label>
          <div className="dlg-actions"><button id="setCancel">Hủy</button><button id="setApply" className="primary">Áp dụng</button></div>
        </form>
      </dialog>

      <dialog id="dlgHelp">
        <h2>Hướng dẫn sử dụng MachSim</h2>
        <div className="help-cols">
          <div>
            <h3>Vẽ mạch</h3>
            <ul>
              <li>Chọn linh kiện ở bảng bên trái, nhấp lên lưới để đặt (giữ <K>Shift</K> để đặt nhiều lần).</li>
              <li>Kéo từ một <b>cực</b> linh kiện hoặc đầu dây để nối dây (tự bẻ góc vuông).</li>
              <li>Dây chạm vào giữa một dây khác sẽ tạo điểm nối chữ T (chấm tròn). Hai dây chỉ cắt nhau thì <b>không</b> nối.</li>
              <li>Vòng tròn đỏ = cực chưa được nối.</li>
              <li>Mỗi mạch cần ít nhất một <b>GND</b> (đất).</li>
              <li>Hai nút ở hai đầu thanh tiêu đề dùng để ẩn/hiện bảng linh kiện và bảng thuộc tính cho rộng chỗ vẽ.</li>
            </ul>
            <h3>Phím tắt</h3>
            <table className="keys"><tbody>
              <tr><td><K>R</K> / <K>Shift+R</K></td><td>Xoay 90°</td></tr>
              <tr><td><K>F</K></td><td>Lật linh kiện</td></tr>
              <tr><td><K>W</K></td><td>Công cụ vẽ dây</td></tr>
              <tr><td><K>V</K> / <K>Esc</K></td><td>Công cụ chọn</td></tr>
              <tr><td><K>Delete</K></td><td>Xóa phần đã chọn</td></tr>
              <tr><td><K>Ctrl+C/V/D</K></td><td>Sao chép / dán / nhân bản</td></tr>
              <tr><td><K>Ctrl+Z</K> / <K>Ctrl+Y</K></td><td>Hoàn tác / làm lại</td></tr>
              <tr><td><K>Space</K></td><td>Chạy / tạm dừng</td></tr>
              <tr><td><K>Home</K>, <K>+</K>, <K>−</K>, lăn chuột</td><td>Vừa khung / thu phóng</td></tr>
              <tr><td>Chuột phải kéo</td><td>Cuộn bản vẽ</td></tr>
              <tr><td><K>G</K> <K>1</K>–<K>9</K> <K>P</K></td><td>GND, R, C, L, V, AC, Diode, LED, NPN, NMOS, Đầu dò</td></tr>
            </tbody></table>
          </div>
          <div>
            <h3>Đo và quan sát</h3>
            <ul>
              <li>Rê chuột lên dây để xem điện áp nút. Nhấp vào linh kiện để xem điện áp, dòng, công suất và <b>vùng làm việc</b> (với BJT/FET).</li>
              <li>Màu dây: xanh lá = dương, đỏ = âm, xám = 0 V. Chấm vàng chuyển động theo chiều dòng điện quy ước (+ → −); nút <b>“I Quy ước / e⁻ Electron”</b> trên thanh công cụ đổi sang chiều electron (chấm xanh, − → +).</li>
              <li>Linh kiện đang chọn có <b>mũi tên ghi giá trị dòng</b> ở mỗi cực; nút <b>“→ I”</b> bật mũi tên cho toàn mạch.</li>
              <li>Dao động ký: đặt <b>Đầu dò</b> lên nút, hoặc chọn linh kiện rồi bấm “Đo điện áp / Đo dòng điện”. Chế độ <b>XY</b> dùng kênh 1 làm trục X để vẽ đặc tuyến.</li>
              <li>Thanh <b>Tốc độ</b>: số giây thời gian mạch trôi qua trong một giây thực.</li>
            </ul>
            <h3>Mô hình</h3>
            <p>Lõi giải dùng phân tích nút cải tiến (MNA) và Newton–Raphson. Diode: Shockley + đánh thủng ngược. BJT: Ebers–Moll + hiệu ứng Early. MOSFET/JFET: Shichman–Hodges (level 1). SCR: mô hình hai transistor. Mô hình đã được đơn giản hoá cho mục đích học tập.</p>
          </div>
        </div>
        <div className="dlg-actions"><button id="helpClose" className="primary">Đóng</button></div>
      </dialog>
    </div>
  );
}
