const TOKEN = process.env.META_ACCESS_TOKEN;
const IDS = process.env.AD_ACCOUNT_IDS.split(',');
const BUDGET = parseInt(process.env.DAILY_BUDGET_CENTS);

// 获取当前巴西时间（小时）
const brtHour = parseInt(new Date().toLocaleString('en-US',
  {timeZone:'America/Sao_Paulo',hour:'numeric',hour12:false}));

// 判断时段
let status, budget;
if (brtHour >= 15 && brtHour < 23) {
  status = 'ACTIVE'; budget = Math.round(BUDGET * 0.65);
} else if (brtHour >= 23 || brtHour < 3) {
  status = 'ACTIVE'; budget = Math.round(BUDGET * 0.25);
} else {
  status = 'PAUSED'; budget = Math.round(BUDGET * 0.10);
}

// 批量更新所有账户下的广告组
for (const accountId of IDS) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${accountId}/adsets`,
    {method:'GET',headers:{Authorization:`Bearer ${TOKEN}`}});
  const {data} = await res.json();
  for (const adset of data) {
    await fetch(`https://graph.facebook.com/v20.0/${adset.id}`,{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},
      body:JSON.stringify({status,daily_budget:budget})
    });
  }
}
