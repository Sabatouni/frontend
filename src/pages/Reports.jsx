function ReportsPage({ db, showToast }) {
  const totalSales = db.sales.reduce((a, b) => a + Number(b.amount), 0);
  const totalExp = db.expenses.reduce((a, b) => a + Number(b.cost), 0);

  const exportExcel = () => {
    if (!db.sales.length && !db.expenses.length) {
      showToast("No data to export", "error");
      return;
    }

    const wb = XLSX.utils.book_new();

    if (db.sales.length) {
      const salesSheet = XLSX.utils.json_to_sheet(db.sales);
      XLSX.utils.book_append_sheet(wb, salesSheet, "Sales");
    }

    if (db.expenses.length) {
      const expSheet = XLSX.utils.json_to_sheet(db.expenses);
      XLSX.utils.book_append_sheet(wb, expSheet, "Expenses");
    }

    XLSX.writeFile(wb, "report.xlsx");
    showToast("Report exported ✓");
  };

  return (
    <div>
      <h1 style={{ marginBottom: 20 }}>Reports</h1>

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <StatCard label="Total Sales" value={TZS(totalSales)} color="#81B29A" />
        <StatCard label="Total Expenses" value={TZS(totalExp)} color="#E07A5F" />
        <StatCard label="Profit" value={TZS(totalSales - totalExp)} color="#3D405B" />
      </div>

      <button
        onClick={exportExcel}
        style={{
          padding: "12px 20px",
          background: "#3D405B",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          fontWeight: 600
        }}
      >
        📄 Export Excel
      </button>
    </div>
  );
}