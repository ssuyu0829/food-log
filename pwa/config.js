// 這個檔會被 push 到公開的 GitHub Pages，所以【只能】放非機密設定。
// Edge Function 的網址不是機密（沒有 token 就讀不到任何東西）。
//
// ⚠️ 拿這份專案自己部署的人：下面這行目前填的是原作者的 Supabase 專案，
//    一定要換成你自己的，否則 PWA 會去打別人的伺服器、拿不到任何資料。
//    值在 Supabase → Project Settings → API Keys → Project URL，
//    格式：https://<你的 project ref>.supabase.co/functions/v1
window.FOODLOG_CONFIG = {
  API_BASE: "https://vhovesvqppxeucyibaok.supabase.co/functions/v1",
};
