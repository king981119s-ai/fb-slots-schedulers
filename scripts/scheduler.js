const TOKEN = process.env.META_ACCESS_TOKEN;
const IDS = process.env.AD_ACCOUNT_IDS.split(',');
const BUDGET = parseInt(process.env.DAILY_BUDGET_CENTS);

const brtHour = parseInt(new Date().toLocaleString('en-US',
  { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));

let status, budget;
if (brtHour >= 15 && brtHour < 23) {
  status = 'ACTIVE'; budget = Math.round(BUDGET * 0.65);
} else if (brtHour >= 23 || brtHour < 3) {
  status = 'ACTIVE'; budget = Math.round(BUDGET * 0.25);
} else {
  status = 'PAUSED'; budget = Math.round(BUDGET * 0.10);
}

console.log(`BRT Hour: ${brtHour} | Status: ${status} | Budget: ${budget}`);

async function run() {
  for (const accountId of IDS) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${accountId.trim()}/adsets?fields=id,name,status&access_token=${TOKEN}`
      );
      const json = await res.json();
      console.log(`账户 ${accountId} 返回:`, JSON.stringify(json));

      if (!json.data || !Array.isArray(json.data)) {
        console.log(`账户 ${accountId} 无广告组或返回错误，跳过`);
        continue;
      }

      if (json.data.length === 0) {
        console.log(`账户 ${accountId} 广告组为空，跳过`);
        continue;
      }

      for (const adset of json.data) {
        const updateRes = await fetch(`https://graph.facebook.com/v20.0/${adset.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            daily_budget: budget,
            access_token: TOKEN
          })
        });
        const updateJson = await updateRes.json();
        console.log(`已更新: ${adset.name} → ${status} | 结果: ${JSON.stringify(updateJson)}`);
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error(`账户 ${accountId} 出错:`, e.message);
    }
  }
}

run();
