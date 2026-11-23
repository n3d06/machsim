/* MachSim – thư viện mạch ví dụ (tập trung vào linh kiện bán dẫn) */
(function (root) {
  'use strict';
  const MS = (root.MS = root.MS || {});

  function builder() {
    const comps = [], wires = [];
    const b = {
      comps, wires,
      c(type, name, x, y, rot, params, flip) {
        const c = { id: MS.uid(), type, name, x, y, rot: rot || 0, flip: !!flip, p: Object.assign(MS.defaultParams(type), params || {}) };
        const d = MS.DEFS[type];
        for (const q of d.params) if (q.preset && params && params[q.k] && d.presets && d.presets[params[q.k]]) Object.assign(c.p, d.presets[params[q.k]], params);
        comps.push(c);
        c.t = MS.terminals(c);
        return c;
      },
      w(...pts) {
        for (let i = 0; i + 1 < pts.length; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
          if (x1 !== x2 || y1 !== y2) wires.push({ x1, y1, x2, y2 });
        }
      }
    };
    return b;
  }

  const EX = [];
  const ex = (o) => EX.push(o);

  ex({
    id: 'diode-basic', group: 'Diode', name: 'Diode phân cực thuận',
    desc: 'Nguồn 5 V nối tiếp điện trở 1 kΩ và diode 1N4148. Quan sát V<sub>D</sub> ≈ 0,6–0,7 V và dòng I = (5 − V<sub>D</sub>)/R. Thử đổi nguồn thành −5 V (phân cực ngược) hoặc đổi giá trị R rồi xem diode ở trạng thái nào trong bảng thuộc tính.',
    build(b) {
      b.c('V', 'V1', 2, 4, 1, { V: '5' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('R', 'R1', 4, 2, 0, { R: '1k' });
      b.w([8, 2], [10, 2]);
      b.c('AM', 'A1', 10, 2, 0);
      b.w([14, 2], [16, 2], [16, 4]);
      b.c('D', 'D1', 16, 4, 1, { model: '1N4148' });
      b.w([16, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.w([16, 4], [19, 4]);
      b.c('VM', 'VD', 19, 4, 1);
      b.w([19, 8], [16, 8]);
    },
    sim: { dt: 1e-5, speed: 1e-3 }
  });

  ex({
    id: 'led', group: 'Diode', name: 'LED và điện trở hạn dòng',
    desc: 'Hai LED (đỏ, lục) với điện trở hạn dòng R = (U − V<sub>F</sub>)/I<sub>F</sub>. Nhấp vào công tắc SW1 để bật/tắt. Thử giảm R xuống 47 Ω để thấy cảnh báo quá dòng.',
    build(b) {
      b.c('V', 'V1', 2, 4, 1, { V: '9' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('SW', 'SW1', 4, 2, 0, { closed: true });
      b.w([8, 2], [10, 2]);
      b.c('R', 'R1', 10, 2, 0, { R: '330' });
      b.w([14, 2], [16, 2], [16, 4]);
      b.c('LED', 'LED1', 16, 4, 1, { color: 'red' });
      b.w([16, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.w([10, 2], [10, -2], [18, -2]);
      b.c('R', 'R2', 18, -2, 0, { R: '470' });
      b.w([22, -2], [24, -2], [24, 4]);
      b.c('LED', 'LED2', 24, 4, 1, { color: 'green' });
      b.w([24, 8], [16, 8]);
    },
    sim: { dt: 1e-5, speed: 1e-3 }
  });

  ex({
    id: 'halfwave', group: 'Diode', name: 'Chỉnh lưu nửa chu kỳ',
    desc: 'Nguồn xoay chiều 12 V/50 Hz qua diode: chỉ nửa chu kỳ dương đi tới tải, đỉnh ra thấp hơn đỉnh vào khoảng 0,7 V. So sánh hai kênh trên dao động ký.',
    build(b) {
      b.c('AC', 'Vac', 2, 4, 1, { amp: '12', freq: '50' });
      b.w([2, 4], [2, 2], [6, 2]);
      b.c('D', 'D1', 6, 2, 0, { model: '1N4007' });
      b.w([10, 2], [14, 2], [14, 4]);
      b.c('R', 'RL', 14, 4, 1, { R: '1k' });
      b.w([14, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.c('PROBE', 'Vào', 2, 2, 0);
      b.c('PROBE', 'Ra', 14, 2, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 5e-5, speed: 0.02, window: 0.06 }
  });

  ex({
    id: 'bridge', group: 'Diode', name: 'Chỉnh lưu cầu + tụ lọc',
    desc: 'Cầu 4 diode chỉnh lưu cả hai nửa chu kỳ. Ban đầu công tắc SW1 mở: điện áp ra là các bướu sin liên tiếp (tần số 100 Hz). <b>Nhấp SW1</b> để nối tụ lọc 470 µF: điện áp ra gần phẳng, chỉ còn độ gợn nhỏ ΔU ≈ I/(2fC). Để ý điện áp ra thấp hơn đỉnh vào khoảng 2 × 0,7 V.',
    build(b) {
      b.c('D', 'D1', 2, 6, 3, { model: '1N4007' });
      b.c('D', 'D2', 2, 10, 3, { model: '1N4007' });
      b.c('D', 'D3', 16, 6, 3, { model: '1N4007' });
      b.c('D', 'D4', 16, 10, 3, { model: '1N4007' });
      b.c('AC', 'Vac', 7, 6, 0, { amp: '12', freq: '50' });
      b.w([2, 6], [7, 6]);
      b.w([11, 6], [16, 6]);
      b.w([2, 2], [16, 2], [22, 2], [26, 2], [26, 4]);
      b.w([2, 10], [16, 10], [22, 10], [26, 10], [26, 8]);
      b.c('SW', 'SW1', 22, 2, 1, { closed: false });
      b.c('C', 'C1', 22, 6, 1, { C: '470u' });
      b.c('R', 'RL', 26, 4, 1, { R: '1k' });
      b.c('GND', 'GND', 22, 10, 0);
      b.c('PROBE', 'Ra', 26, 2, 0);
    },
    scope: [{ comp: 'Vac', kind: 'v' }, 'Ra'],
    sim: { dt: 5e-5, speed: 0.02, window: 0.06 }
  });

  ex({
    id: 'zener', group: 'Diode', name: 'Ổn áp dùng Zener',
    desc: 'Điện áp vào dao động 9–15 V (12 V DC + gợn 3 V). Diode Zener 5,1 V giữ điện áp trên tải gần như không đổi. Dòng qua Zener thay đổi để bù: I<sub>Z</sub> = (U<sub>vào</sub> − V<sub>Z</sub>)/R − I<sub>tải</sub>. Thử giảm R<sub>L</sub> xuống 200 Ω: Zener mất ổn áp vì không còn đủ dòng.',
    build(b) {
      b.c('AC', 'Vin', 2, 4, 1, { amp: '3', offset: '12', freq: '50' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('R', 'R1', 4, 2, 0, { R: '470' });
      b.w([8, 2], [12, 2], [12, 4]);
      b.c('DZ', 'DZ1', 12, 8, 3, { model: '5V1' });
      b.w([12, 2], [16, 2], [16, 4]);
      b.c('R', 'RL', 16, 4, 1, { R: '1k' });
      b.w([16, 8], [12, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.w([16, 4], [19, 4]);
      b.c('VM', 'Vout', 19, 4, 1);
      b.w([19, 8], [16, 8]);
      b.c('PROBE', 'Vào', 2, 2, 0);
      b.c('PROBE', 'Ra', 16, 2, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 5e-5, speed: 0.02, window: 0.06 }
  });

  ex({
    id: 'clipper', group: 'Diode', name: 'Mạch xén hai phía',
    desc: 'Hai diode mắc song song ngược chiều giới hạn điện áp ra trong khoảng ±0,7 V, bất kể biên độ vào. Đây là mạch bảo vệ đầu vào thường gặp. Thử thay một diode bằng Zener để xén ở mức khác.',
    build(b) {
      b.c('AC', 'Vin', 2, 4, 1, { amp: '5', freq: '1k' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('R', 'R1', 4, 2, 0, { R: '1k' });
      b.w([8, 2], [12, 2], [12, 4]);
      b.c('D', 'D1', 12, 4, 1);
      b.c('D', 'D2', 16, 8, 3);
      b.w([12, 2], [16, 2], [16, 4]);
      b.w([16, 8], [12, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.c('PROBE', 'Vào', 2, 2, 0);
      b.c('PROBE', 'Ra', 16, 2, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 2e-6, speed: 1e-3, window: 3e-3 }
  });

  ex({
    id: 'clamper', group: 'Diode', name: 'Mạch ghim (dịch mức DC)',
    desc: 'Tụ nạp tới đỉnh âm của tín hiệu qua diode, sau đó cộng điện áp này vào tín hiệu: dạng sóng ra giữ nguyên nhưng bị “nâng” lên, đỉnh âm bị ghim ở ≈ −0,7 V. Đảo chiều diode để ghim đỉnh dương.',
    build(b) {
      b.c('AC', 'Vin', 2, 4, 1, { amp: '5', freq: '1k' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('C', 'C1', 4, 2, 0, { C: '10u' });
      b.w([8, 2], [12, 2], [12, 4]);
      b.c('D', 'D1', 12, 8, 3);
      b.w([12, 2], [16, 2], [16, 4]);
      b.c('R', 'RL', 16, 4, 1, { R: '100k' });
      b.w([16, 8], [12, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.c('PROBE', 'Vào', 2, 2, 0);
      b.c('PROBE', 'Ra', 16, 2, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 2e-6, speed: 1e-3, window: 3e-3 }
  });

  ex({
    id: 'doubler', group: 'Diode', name: 'Mạch nhân đôi điện áp',
    desc: 'Mạch Greinacher: C1 nạp tới đỉnh ở nửa chu kỳ âm, nửa chu kỳ dương điện áp trên C1 cộng với nguồn nạp C2 tới ≈ 2·U<sub>m</sub> − 2·0,7 V. Quan sát điện áp ra tăng dần qua từng chu kỳ.',
    build(b) {
      b.c('AC', 'Vin', 2, 4, 1, { amp: '10', freq: '1k' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('C', 'C1', 4, 2, 0, { C: '10u' });
      b.w([8, 2], [10, 2], [10, 4]);
      b.c('D', 'D1', 10, 8, 3);
      b.w([10, 2], [12, 2]);
      b.c('D', 'D2', 12, 2, 0);
      b.w([16, 2], [18, 2], [18, 4]);
      b.c('C', 'C2', 18, 4, 1, { C: '10u' });
      b.w([18, 2], [22, 2], [22, 4]);
      b.c('R', 'RL', 22, 4, 1, { R: '100k' });
      b.w([22, 8], [18, 8], [10, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
      b.c('PROBE', 'Vào', 2, 2, 0);
      b.c('PROBE', 'Ra', 22, 2, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 5e-6, speed: 4e-3, window: 0.01 }
  });

  ex({
    id: 'diode-xy', group: 'Diode', name: 'Vẽ đặc tuyến Zener trên dao động ký (XY)',
    desc: 'Sóng tam giác ±6 V quét qua Zener 3,3 V. Dao động ký ở chế độ <b>XY</b>: trục X = điện áp trên diode, trục Y = dòng qua diode ⇒ hiện ra đặc tuyến V–A với vùng dẫn thuận (≈ 0,7 V) và vùng đánh thủng (≈ −3,3 V).',
    build(b) {
      b.c('AC', 'Vin', 2, 4, 1, { wave: 'triangle', amp: '6', freq: '50' });
      b.w([2, 4], [2, 2], [4, 2]);
      b.c('R', 'R1', 4, 2, 0, { R: '220' });
      b.w([8, 2], [10, 2], [10, 4]);
      b.c('DZ', 'DZ1', 10, 4, 1, { model: '3V3' });
      b.w([10, 8], [2, 8]);
      b.c('GND', 'GND', 2, 8, 0);
    },
    scope: [{ comp: 'DZ1', kind: 'v' }, { comp: 'DZ1', kind: 'i' }],
    xy: true,
    sim: { dt: 2e-5, speed: 0.02, window: 0.04 }
  });

  ex({
    id: 'bjt-region', group: 'BJT', name: 'Vùng làm việc của BJT',
    desc: 'Kéo con chạy biến trở VR1 (bảng thuộc tính bên phải) để thay đổi dòng I<sub>B</sub>. Quan sát transistor chuyển từ <b>Tắt</b> → <b>Khuếch đại</b> (I<sub>C</sub> = β·I<sub>B</sub>) → <b>Bão hòa</b> (V<sub>CE</sub> ≈ 0,1 V, I<sub>C</sub> không tăng nữa).',
    build(b) {
      b.c('V', 'V1', 0, 4, 1, { V: '12' });
      b.w([0, 4], [0, 0], [4, 0], [18, 0]);
      b.w([0, 8], [0, 14], [4, 14], [18, 14]);
      b.c('GND', 'GND', 0, 14, 0);
      b.c('POT', 'VR1', 4, 0, 1, { R: '10k', pos: 0.3 }, true);
      b.w([4, 4], [4, 14]);
      b.c('R', 'RB', 6, 2, 0, { R: '47k' });
      b.c('AM', 'IB', 10, 2, 0);
      b.w([14, 2], [14, 10], [16, 10]);
      b.c('R', 'RC', 18, 0, 1, { R: '1k' });
      b.c('AM', 'IC', 18, 4, 1);
      b.c('NPN', 'Q1', 16, 10, 0, { model: 'Lý tưởng hoá (β=100)' });
      b.w([18, 12], [18, 14]);
      b.w([18, 8], [21, 8]);
      b.c('VM', 'VCE', 21, 8, 1);
      b.w([21, 12], [18, 12]);
    },
    sim: { dt: 1e-5, speed: 1e-3 }
  });

  ex({
    id: 'bjt-switch', group: 'BJT', name: 'BJT làm khóa điều khiển LED',
    desc: 'Dòng nhỏ vào cực B (≈ 0,8 mA) điều khiển dòng lớn hơn qua LED ở cực C. Khi SW1 đóng, transistor <b>bão hòa</b> (V<sub>CE</sub> ≈ 0,1 V) ⇒ LED sáng; khi mở, transistor <b>tắt</b>. Nhấp SW1 để thử.',
    build(b) {
      b.c('V', 'V1', 0, 4, 1, { V: '9' });
      b.w([0, 4], [0, 0], [4, 0], [14, 0]);
      b.w([0, 8], [0, 12], [14, 12]);
      b.c('GND', 'GND', 0, 12, 0);
      b.c('R', 'RC', 14, 0, 1, { R: '470' });
      b.c('LED', 'LED1', 14, 4, 1, { color: 'green' });
      b.c('NPN', 'Q1', 12, 10, 0, { model: '2N2222' });
      b.c('SW', 'SW1', 4, 0, 1, { closed: false });
      b.w([4, 4], [4, 10], [6, 10]);
      b.c('R', 'RB', 6, 10, 0, { R: '10k' });
      b.w([10, 10], [12, 10]);
    },
    sim: { dt: 1e-4, speed: 0.05 }
  });

  ex({
    id: 'ce-amp', group: 'BJT', name: 'Khuếch đại E chung (CE)',
    desc: 'Tầng khuếch đại kinh điển: phân cực bằng cầu chia áp R1–R2, ổn định nhiệt bằng R<sub>E</sub>, tụ C<sub>E</sub> thoát xoay chiều. Hệ số khuếch đại A<sub>v</sub> ≈ −(R<sub>C</sub>∥R<sub>L</sub>)/r<sub>e</sub>, với r<sub>e</sub> = V<sub>T</sub>/I<sub>E</sub>. Tín hiệu ra <b>ngược pha</b> với tín hiệu vào. Thử tăng biên độ vào lên 100 mV để thấy méo (xén) tín hiệu; hoặc xóa C<sub>E</sub> để thấy hệ số khuếch đại giảm mạnh.',
    build(b) {
      b.c('V', 'VCC', 0, 6, 1, { V: '12' });
      b.w([0, 6], [0, 0], [10, 0], [14, 0]);
      b.w([0, 10], [0, 16], [4, 16], [10, 16], [14, 16], [17, 16], [24, 16]);
      b.c('GND', 'GND', 0, 16, 0);
      b.c('R', 'R1', 10, 0, 1, { R: '47k' });
      b.w([10, 4], [10, 6], [10, 8]);
      b.c('R', 'R2', 10, 8, 1, { R: '10k' });
      b.w([10, 12], [10, 16]);
      b.w([10, 6], [12, 6]);
      b.c('NPN', 'Q1', 12, 6, 0, { model: '2N2222' });
      b.c('R', 'RC', 14, 0, 1, { R: '2.2k' });
      b.c('R', 'RE', 14, 8, 1, { R: '1k' });
      b.w([14, 12], [14, 16]);
      b.w([14, 8], [17, 8]);
      b.c('C', 'CE', 17, 8, 1, { C: '100u' });
      b.w([17, 12], [17, 16]);
      b.w([14, 4], [18, 4]);
      b.c('C', 'Cout', 18, 4, 0, { C: '10u' });
      b.w([22, 4], [24, 4], [24, 8]);
      b.c('R', 'RL', 24, 8, 1, { R: '10k' });
      b.w([24, 12], [24, 16]);
      b.c('AC', 'Vs', 4, 10, 1, { amp: '20m', freq: '1k' });
      b.w([4, 14], [4, 16]);
      b.w([4, 10], [4, 6], [6, 6]);
      b.c('C', 'Cin', 6, 6, 0, { C: '10u' });
      b.c('PROBE', 'Vào', 4, 6, 0);
      b.c('PROBE', 'Ra', 24, 4, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 5e-6, speed: 1e-3, window: 3e-3 }
  });

  ex({
    id: 'mirror', group: 'BJT', name: 'Gương dòng điện',
    desc: 'Q1 nối kiểu diode tạo V<sub>BE</sub> ứng với dòng chuẩn I<sub>ref</sub> ≈ (V<sub>CC</sub> − 0,7)/R<sub>ref</sub>. Q2 có cùng V<sub>BE</sub> nên “sao chép” dòng này sang tải: I<sub>out</sub> ≈ I<sub>ref</sub>, gần như không phụ thuộc R<sub>L</sub>. Sai lệch nhỏ là do dòng base và hiệu ứng Early. Thử thay đổi R<sub>L</sub>.',
    build(b) {
      b.c('V', 'VCC', 0, 3, 1, { V: '12' });
      b.w([0, 3], [0, -4], [8, -4], [14, -4]);
      b.w([0, 7], [0, 14], [8, 14], [14, 14]);
      b.c('GND', 'GND', 0, 14, 0);
      b.c('R', 'Rref', 8, -4, 1, { R: '10k' });
      b.c('AM', 'Iref', 8, 0, 1);
      b.w([8, 4], [8, 6]);
      b.c('NPN', 'Q1', 10, 8, 2, { model: '2N3904' }, true);
      b.c('NPN', 'Q2', 12, 8, 0, { model: '2N3904' });
      b.w([10, 8], [12, 8]);
      b.w([8, 6], [11, 6], [11, 8]);
      b.w([8, 10], [8, 14]);
      b.w([14, 10], [14, 14]);
      b.c('R', 'RL', 14, -4, 1, { R: '2.2k' });
      b.c('AM', 'Iout', 14, 0, 1);
      b.w([14, 4], [14, 6]);
    },
    sim: { dt: 1e-5, speed: 1e-3 }
  });

  ex({
    id: 'astable', group: 'BJT', name: 'Dao động đa hài (LED nhấp nháy)',
    desc: 'Hai transistor thay phiên dẫn bão hòa nhờ hai tụ hồi tiếp chéo ⇒ hai LED nháy luân phiên. Chu kỳ T ≈ 0,69·(R<sub>B1</sub>C<sub>2</sub> + R<sub>B2</sub>C<sub>1</sub>). Quan sát điện áp cực B của Q1 nạp lại theo hàm mũ trên dao động ký. Thử đổi giá trị tụ để thay đổi tần số.',
    build(b) {
      b.c('V', 'VCC', 0, 7, 1, { V: '9' });
      b.w([0, 7], [0, 0], [4, 0], [9, 0], [15, 0], [20, 0]);
      b.w([0, 11], [0, 18], [4, 18], [20, 18]);
      b.c('GND', 'GND', 0, 18, 0);
      b.c('R', 'RC1', 4, 0, 1, { R: '470' });
      b.c('LED', 'LED1', 4, 4, 1, { color: 'red' });
      b.w([4, 8], [4, 12]);
      b.c('NPN', 'Q1', 6, 14, 2, { model: '2N2222' }, true);
      b.w([4, 16], [4, 18]);
      b.c('R', 'RC2', 20, 0, 1, { R: '470' });
      b.c('LED', 'LED2', 20, 4, 1, { color: 'green' });
      b.w([20, 8], [20, 12]);
      b.c('NPN', 'Q2', 18, 14, 0, { model: '2N2222' });
      b.w([20, 16], [20, 18]);
      b.c('R', 'RB1', 9, 0, 1, { R: '47k' });
      b.w([9, 4], [9, 14], [6, 14]);
      b.c('R', 'RB2', 15, 0, 1, { R: '47k' });
      b.w([15, 4], [15, 14], [18, 14]);
      b.w([4, 8], [10, 8]);
      b.c('C', 'C1', 10, 8, 0, { C: '10u' });
      b.w([14, 8], [15, 8]);
      b.w([9, 12], [10, 12]);
      b.c('C', 'C2', 10, 12, 0, { C: '12u' });
      b.w([14, 12], [20, 12]);
      b.c('PROBE', 'VB1', 9, 6, 0);
      b.c('PROBE', 'VC1', 4, 12, 0);
    },
    scope: ['VC1', 'VB1'],
    sim: { dt: 2e-4, speed: 0.5, window: 3, dcStart: false }
  });

  ex({
    id: 'mos-switch', group: 'MOSFET', name: 'MOSFET làm khóa',
    desc: 'Xung vuông 0/5 V, 1 Hz điều khiển cực G của MOSFET 2N7000. Vì cực G cách điện nên gần như không tốn dòng điều khiển. V<sub>GS</sub> = 5 V > V<sub>th</sub> ⇒ MOSFET dẫn (vùng triode, như điện trở nhỏ) ⇒ LED sáng; V<sub>GS</sub> = 0 ⇒ ngắt.',
    build(b) {
      b.c('V', 'VDD', 0, 4, 1, { V: '12' });
      b.w([0, 4], [0, 0], [12, 0]);
      b.w([0, 8], [0, 14], [4, 14], [12, 14]);
      b.c('GND', 'GND', 0, 14, 0);
      b.c('R', 'RD', 12, 0, 1, { R: '470' });
      b.c('LED', 'LED1', 12, 4, 1, { color: 'white' });
      b.c('NMOS', 'M1', 10, 10, 0, { model: '2N7000' });
      b.w([12, 12], [12, 14]);
      b.c('AC', 'Vxung', 4, 10, 1, { wave: 'square', amp: '2.5', offset: '2.5', freq: '1' });
      b.w([4, 10], [6, 10]);
      b.c('R', 'RG', 6, 10, 0, { R: '100' });
      b.c('PROBE', 'VG', 4, 10, 0);
      b.c('PROBE', 'VD', 12, 8, 0);
    },
    scope: ['VG', 'VD'],
    sim: { dt: 1e-3, speed: 1, window: 3 }
  });

  ex({
    id: 'cmos-inv', group: 'MOSFET', name: 'Cổng đảo CMOS – đặc tuyến truyền đạt',
    desc: 'PMOS (trên) và NMOS (dưới) bổ phụ: khi vào mức thấp PMOS dẫn ⇒ ra = V<sub>DD</sub>; vào mức cao NMOS dẫn ⇒ ra = 0. Dao động ký ở chế độ <b>XY</b> (X = V<sub>vào</sub>, Y = V<sub>ra</sub>) vẽ ra đặc tuyến truyền đạt điện áp (VTC), chuyển mạch tại ≈ V<sub>DD</sub>/2. Thử đổi β của một transistor để thấy ngưỡng dịch chuyển.',
    build(b) {
      b.c('V', 'VDD', 0, 4, 1, { V: '5' });
      b.w([0, 4], [0, 0], [12, 0], [12, 2]);
      b.w([0, 8], [0, 16], [4, 16], [12, 16]);
      b.c('GND', 'GND', 0, 16, 0);
      b.c('PMOS', 'MP', 10, 4, 0, { model: 'CMOS (W/L nhỏ)' }, true);
      b.c('NMOS', 'MN', 10, 10, 0, { model: 'CMOS (W/L nhỏ)' });
      b.w([12, 6], [12, 8]);
      b.w([12, 12], [12, 16]);
      b.w([10, 4], [8, 4], [8, 10], [10, 10]);
      b.c('AC', 'Vin', 4, 10, 1, { wave: 'triangle', amp: '2.5', offset: '2.5', freq: '100' });
      b.w([4, 10], [8, 10]);
      b.w([4, 14], [4, 16]);
      b.w([12, 7], [16, 7]);
      b.c('PROBE', 'Vào', 4, 10, 0);
      b.c('PROBE', 'Ra', 16, 7, 0);
    },
    scope: ['Vào', 'Ra'],
    xy: true,
    sim: { dt: 1e-5, speed: 0.01, window: 0.02 }
  });

  ex({
    id: 'jfet-amp', group: 'JFET', name: 'Khuếch đại JFET nguồn chung',
    desc: 'JFET kênh N tự phân cực: dòng I<sub>D</sub> qua R<sub>S</sub> tạo V<sub>GS</sub> = −I<sub>D</sub>R<sub>S</sub> âm (cực G nối đất qua R<sub>G</sub> 1 MΩ). Hệ số khuếch đại A<sub>v</sub> ≈ −g<sub>m</sub>(R<sub>D</sub>∥R<sub>L</sub>), với g<sub>m</sub> = (2I<sub>DSS</sub>/|V<sub>P</sub>|)(1 − V<sub>GS</sub>/V<sub>P</sub>). Trở kháng vào rất lớn.',
    build(b) {
      b.c('V', 'VDD', 0, 6, 1, { V: '15' });
      b.w([0, 6], [0, 0], [14, 0]);
      b.w([0, 10], [0, 16], [4, 16], [10, 16], [14, 16], [17, 16], [24, 16]);
      b.c('GND', 'GND', 0, 16, 0);
      b.c('NJF', 'J1', 12, 6, 0, { Idss: '10m', Vp: '-3' });
      b.c('R', 'RD', 14, 0, 1, { R: '2.2k' });
      b.c('R', 'RS', 14, 8, 1, { R: '470' });
      b.w([14, 12], [14, 16]);
      b.w([14, 8], [17, 8]);
      b.c('C', 'CS', 17, 8, 1, { C: '100u' });
      b.w([17, 12], [17, 16]);
      b.w([10, 8], [10, 6], [12, 6]);
      b.c('R', 'RG', 10, 8, 1, { R: '1M' });
      b.w([10, 12], [10, 16]);
      b.c('C', 'Cin', 6, 6, 0, { C: '1u' });
      b.c('AC', 'Vs', 4, 10, 1, { amp: '100m', freq: '1k' });
      b.w([4, 10], [4, 6], [6, 6]);
      b.w([4, 14], [4, 16]);
      b.w([14, 4], [18, 4]);
      b.c('C', 'Cout', 18, 4, 0, { C: '10u' });
      b.w([22, 4], [24, 4], [24, 8]);
      b.c('R', 'RL', 24, 8, 1, { R: '10k' });
      b.w([24, 12], [24, 16]);
      b.c('PROBE', 'Vào', 4, 6, 0);
      b.c('PROBE', 'Ra', 24, 4, 0);
    },
    scope: ['Vào', 'Ra'],
    sim: { dt: 5e-6, speed: 1e-3, window: 3e-3 }
  });

  ex({
    id: 'scr-latch', group: 'Thyristor', name: 'SCR – mạch chốt',
    desc: 'SCR chỉ dẫn khi được kích ở cực G và sau đó <b>tự giữ</b>. Thử: (1) nhấp SW2 để đóng ⇒ có dòng kích ⇒ LED sáng; (2) nhấp SW2 lần nữa để mở ⇒ LED <b>vẫn sáng</b>; (3) mở SW1 để ngắt dòng anode ⇒ SCR tắt; (4) đóng lại SW1 ⇒ LED vẫn tắt cho tới khi được kích lại.',
    build(b) {
      b.c('V', 'V1', 0, 4, 1, { V: '12' });
      b.w([0, 4], [0, 0], [4, 0], [8, 0]);
      b.w([0, 8], [0, 14], [16, 14]);
      b.c('GND', 'GND', 0, 14, 0);
      b.c('SW', 'SW1', 8, 0, 0, { closed: true });
      b.w([12, 0], [16, 0]);
      b.c('R', 'RL', 16, 0, 1, { R: '680' });
      b.c('LED', 'LED1', 16, 4, 1, { color: 'red' });
      b.c('SCR', 'SCR1', 16, 8, 1);
      b.w([16, 12], [16, 14]);
      b.c('SW', 'SW2', 4, 0, 1, { closed: false });
      b.w([4, 4], [4, 11], [8, 11]);
      b.c('R', 'RG', 8, 11, 0, { R: '4.7k' });
      b.w([12, 11], [14, 11]);
    },
    sim: { dt: 1e-4, speed: 0.05 }
  });

  MS.EXAMPLES = EX;
  MS.buildExample = function (e) {
    const b = builder();
    e.build(b);
    for (const c of b.comps) delete c.t;
    const byName = (n) => b.comps.find((c) => c.name === n);
    const scope = (e.scope || []).map((s) => {
      if (typeof s === 'string') { const c = byName(s); return c ? { id: c.id, kind: 'v' } : null; }
      const c = byName(s.comp);
      return c ? { id: c.id, kind: s.kind } : null;
    }).filter(Boolean);
    return {
      version: 1, comps: b.comps, wires: b.wires,
      sim: Object.assign({ dt: 1e-5, speed: 1e-3, window: 0.01, dcStart: true }, e.sim || {}),
      scope: { signals: scope, xy: !!e.xy },
      example: e.id
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
