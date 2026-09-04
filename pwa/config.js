// 這個檔會被 push 到公開的 GitHub Pages，所以【只能】放非機密設定。
// Edge Function 的網址不是機密（沒有 token 就讀不到任何東西）。
window.FOODLOG_CONFIG = {
  // Supabase → Project Settings → API → Project URL 的 xxxx 部分
  // 例：https://abcdefgh.supabase.co/functions/v1
  API_BASE: "https://vhovesvqppxeucyibaok.supabase.co/functions/v1",
};
