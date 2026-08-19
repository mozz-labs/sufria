export default function Home() {
  return (
    <main style={{ padding: "3rem 2rem", maxWidth: "48rem", margin: "0 auto" }}>
      <h1 style={{ fontWeight: 800, fontSize: "2.25rem" }}>
        وفا — فحص الواجهة
      </h1>
      <h2 style={{ fontWeight: 700, fontSize: "1.5rem", marginTop: "0.75rem" }}>
        عنوان فرعي بخط Almarai وزن ٧٠٠
      </h2>

      <p style={{ marginTop: "2rem", fontWeight: 400 }}>
        نص عادي بخط IBM Plex Sans Arabic وزن ٤٠٠. الاتجاه من اليمين لليسار.
      </p>
      <p style={{ marginTop: "0.5rem", fontWeight: 500 }}>
        نص متوسط وزن ٥٠٠ — الأرقام ١٢٣٤٥٦٧٨٩٠ و 1234567890.
      </p>
      <p style={{ marginTop: "0.5rem", fontWeight: 600 }}>
        نص عريض وزن ٦٠٠ للتأكيد داخل الفقرات.
      </p>

      <ul style={{ marginTop: "2rem", paddingInlineStart: "1.25rem" }}>
        <li>النقطة لازم تكون على اليمين — هيك بنتأكد إن RTL شغال</li>
        <li>الخطوط محمّلة من Google Fonts وقت البناء، مش وقت التصفح</li>
        <li>الألوان لسه مؤقتة — بتتبدل لما يخلص DESIGN.md</li>
      </ul>
    </main>
  );
}
