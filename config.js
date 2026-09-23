window.TAQSS_CONFIG = {
  // يعمل المشروع مباشرة بهذه الخدمة للطقس/التاريخ/الصلاة.
  stationApiBase: "https://mahatta-api.muala99.workers.dev",

  // عامل طقس داشبورد المنشور؛ الأسعار تعمل منه، وبقية الخدمات تُمرّر لعامل المحطة عند عدم وجود مفتاح WU.
  dashboardApiBase: "https://taqss-dashboard-api.muala99.workers.dev",

  stationId: "IMEDIN86",
  stationLocation: "قرب أبيار الماشي",
  stationStartDate: "2026-06-05",
  latitude: 24.234096,
  longitude: 39.551125,
  timeZone: "Asia/Riyadh",
  marketsRefreshMs: 60000,

  // إعدادات إدارة قائمة الأسهم. المفتاح الإداري نفسه يبقى Secret داخل العامل.
  marketsConfigWriteEnabled: true
};
