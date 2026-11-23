# MachSim – Giả lập mạch điện tử cho sinh viên Điện – Điện tử

Ứng dụng web vẽ và mô phỏng mạch điện tử **chạy hoàn toàn trên trình duyệt** (không cần cài đặt, không cần máy chủ). Giai đoạn 1 tập trung vào **linh kiện bán dẫn**.

## Tính năng

**Thiết kế & mô phỏng mạch**
- Vẽ sơ đồ trên lưới: kéo thả linh kiện, nối dây (tự bẻ góc), xoay/lật, chọn vùng, sao chép/dán, hoàn tác/làm lại.
- Mô phỏng quá độ theo thời gian thực: màu dây theo điện áp, chấm vàng chạy theo chiều dòng điện, LED sáng theo dòng.
- Bảng thuộc tính hiển thị số đo trực tiếp (U, I, P) và **vùng làm việc** của BJT/FET (tắt / khuếch đại / bão hòa / triode…), kèm phần lý thuyết ngắn cho từng linh kiện.
- Dao động ký nhiều kênh (thang V/div tự động, chế độ **XY** để vẽ đặc tuyến), vôn kế, ampe kế, đầu dò.
- Lưu/mở tệp `.json`, tự lưu vào trình duyệt, chia sẻ mạch qua liên kết.

**Linh kiện**
| Nhóm | Linh kiện |
|---|---|
| Cơ bản | GND, điện trở, tụ, cuộn cảm, nguồn áp DC, máy phát sóng (sin/vuông/tam giác/răng cưa), nguồn dòng, công tắc, biến trở |
| Bán dẫn | Diode chỉnh lưu (1N4148, 1N4007), Schottky, Zener, LED (5 màu), BJT NPN/PNP (2N2222, 2N3904, BC547, 2N3906…), MOSFET kênh N/P (2N7000, IRF540, BS250…), JFET kênh N/P, Thyristor (SCR) |
| Op-amp & Logic | Op-amp (LM741, TL081, LM358 – có bão hòa và GBW), cổng NOT/AND/OR/NAND/NOR/XOR, đầu vào logic 0/1, đèn báo logic |
| Đo lường | Đầu dò dao động ký, vôn kế, ampe kế |

**Đặc tuyến linh kiện** – vẽ trực tiếp từ mô hình: đặc tuyến V–A diode (tuyến tính/log), họ đặc tuyến ra và đặc tuyến vào BJT, đặc tuyến ra và truyền đạt MOSFET/JFET, **đường tải tĩnh và điểm Q**.

**26 mạch ví dụ**: diode phân cực, LED, chỉnh lưu nửa chu kỳ, chỉnh lưu cầu + tụ lọc, ổn áp Zener, mạch xén, mạch ghim, nhân đôi điện áp, vẽ đặc tuyến Zener bằng XY, vùng làm việc BJT, BJT làm khóa, khuếch đại E chung, gương dòng, dao động đa hài, MOSFET làm khóa, cổng đảo CMOS (VTC), khuếch đại JFET, SCR mạch chốt; op-amp: khuếch đại đảo/không đảo, Schmitt trigger (vòng trễ XY), tích phân, dao động xung vuông; logic: các cổng cơ bản, bộ cộng bán phần, mạch chốt SR.

## Chạy thử

Mở trực tiếp `index.html` trong trình duyệt, hoặc chạy máy chủ tĩnh:

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

**Đưa lên mạng (GitHub Pages):** repo đã có workflow `.github/workflows/deploy.yml`. Vào *Settings → Pages → Source* chọn **GitHub Actions**. Mỗi lần push lên `main`, workflow sẽ:
1. chạy `node tools/test.js` (lỗi thì không deploy);
2. gắn `?v=<mã commit>` vào mọi tệp CSS/JS và đặt phiên bản cho Service Worker;
3. deploy lên `https://<tên-tài-khoản>.github.io/machsim/`.

**Cache:** bản deploy dùng Service Worker (`sw.js`) lưu toàn bộ ứng dụng vào bộ nhớ đệm của trình duyệt — lần sau mở tức thì, **chạy được cả khi mất mạng**, và có thể cài như ứng dụng (PWA). CSS/JS lấy từ cache trước; trang HTML ưu tiên mạng nên khi có bản deploy mới, trình duyệt nhận đường dẫn `?v=` mới, tải bản mới và tự xoá cache cũ. Khi chạy thử ở máy (không qua workflow) Service Worker không bật, để luôn thấy code mới nhất.

## Mô hình & lõi giải

- Phân tích nút cải tiến (MNA), giải hệ phi tuyến bằng Newton–Raphson có giới hạn bước tiếp giáp (pnjlim) và giới hạn V_GS.
- Tích phân thời gian: Euler lùi (mặc định, ổn định) hoặc hình thang; tự chia nhỏ bước khi không hội tụ.
- Diode: phương trình Shockley + đánh thủng ngược. BJT: Ebers–Moll + hiệu ứng Early. MOSFET/JFET: Shichman–Hodges (level 1). SCR: mô hình hai transistor PNP–NPN. Op-amp: khuếch đại A với một cực (GBW) và bão hòa mềm. Cổng logic: hàm chuyển trơn quanh ngưỡng V_H/2, đầu ra 50 Ω. BJT/FET có điện dung tiếp giáp nhỏ để mô phỏng chuyển mạch.
- Các mô hình đã được đơn giản hoá cho mục đích học tập.

## Cấu trúc

```
index.html          giao diện
css/style.css       giao diện sáng/tối
js/util.js          đọc/ghi số có tiền tố SI (4.7k, 10u, …)
js/engine.js        lõi giải MNA + Newton–Raphson + bước thời gian thích nghi
js/components.js    mô hình, tham số, ký hiệu, lý thuyết từng linh kiện
js/netlist.js       chuyển sơ đồ thành netlist, tính dòng trên dây
js/examples.js      các mạch ví dụ
js/scope.js         dao động ký
js/plot.js          vẽ đồ thị
js/curves.js        trang đặc tuyến linh kiện
js/app.js           trình soạn thảo sơ đồ, điều khiển mô phỏng
tools/test.js       kiểm tra tự động lõi mô phỏng và các mạch ví dụ
```

## Kiểm tra

```bash
node tools/test.js
```

Kiểm tra mọi mạch ví dụ (không có cực hở, mô phỏng hội tụ) và đối chiếu kết quả với lý thuyết: hệ số khuếch đại tầng CE/JFET, độ gợn chỉnh lưu, chốt SCR, ngưỡng CMOS, mạch xén, nhân áp, tần số đa hài…

## Hướng phát triển

- Flip-flop D/JK, bộ đếm, IC 555, transistor quang, opto, TRIAC/DIAC.
- Phân tích AC (đáp ứng tần số, Bode), quét DC.
- Mô hình nhiệt độ, điện trở nối tiếp của diode/BJT.
