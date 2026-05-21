const TOKEN = process.env.META_ACCESS_TOKEN;
const IDS = process.env.AD_ACCOUNT_IDS.split(',');
const BUDGET = parseInt(process.env.DAILY_BUDGET_CENTS);

// 监控阈值
const MIN_REGISTRATIONS = 2;   // 注册数需大于此值才算达标
const MAX_COST_PER_REG = 7;    // 成效成本需低于此美金才算达标

// 投放时段控制（巴西时间 BRT）
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

console.log(`BRT Hour: ${brtHour} | 时段状态: ${status} | 预算: ${budget}`);

/**
 * 检查广告系列表现，返回是否需要暂停
 *
 * 暂停逻辑：
 *   成本 >= $7 且 注册数 <= 2 → 暂停（两个条件都不达标）
 *   成本 < $7 或 注册数 > 2  → 继续（任意一个达标即可）
 *   今日暂无数据              → 继续（广告刚开始跑，不干预）
 */
async function checkCampaignPerformance(campaignId) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${campaignId}/insights?fields=actions,cost_per_action_type&date_preset=today&access_token=${TOKEN}`
    );
    const json = await res.json();

    // 今日暂无数据 → 继续投放，不干预
    if (!json.data || json.data.length === 0) {
      console.log(`广告系列 ${campaignId} 今日暂无数据，继续投放`);
      return false;
    }

    const insight = json.data[0];

    // 获取注册数
    const actions = insight.actions || [];
    const regAction = actions.find(a =>
      a.action_type === 'complete_registration' ||
      a.action_type === 'lead'
    );
    const registrations = regAction ? parseInt(regAction.value) : 0;

    // 获取成效成本
    const costActions = insight.cost_per_action_type || [];
    const costAction = costActions.find(a =>
      a.action_type === 'complete_registration' ||
      a.action_type === 'lead'
    );
    const costPerReg = costAction ? parseFloat(costAction.value) : 0;

    // 达标判断
    const costOk = costPerReg < MAX_COST_PER_REG;   // 成本 < $7
    const regOk  = registrations > MIN_REGISTRATIONS; // 注册数 > 2

    console.log(
      `广告系列 ${campaignId} | 注册数: ${registrations}(${regOk ? '✅' : '❌'}) | ` +
      `成效成本: $${costPerReg.toFixed(2)}(${costOk ? '✅' : '❌'})`
    );

    // 两个条件都不达标 → 暂停
    if (!costOk && !regOk) {
      console.log(
        `⚠️ 广告系列 ${campaignId} 触发暂停：` +
        `成效成本($${costPerReg.toFixed(2)}) >= $${MAX_COST_PER_REG} ` +
        `且 注册数(${registrations}) <= ${MIN_REGISTRATIONS}`
      );
      return true;
    }

    // 任意一个达标 → 继续投放
    console.log(`✅ 广告系列 ${campaignId} 达标，继续投放`);
    return false;

  } catch (e) {
    console.error(`检查广告系列 ${campaignId} 出错:`, e.message);
    return false; // 出错时不暂停，保守处理
  }
}

async function run() {
  for (const accountId of IDS) {
    try {
      // 获取所有广告系列
      const campRes = await fetch(
        `https://graph.facebook.com/v20.0/${accountId.trim()}/campaigns?fields=id,name,status&access_token=${TOKEN}`
      );
      const campJson = await campRes.json();

      if (!campJson.data || !Array.isArray(campJson.data)) {
        console.log(`账户 ${accountId} 无广告系列，跳过`);
        continue;
      }

      for (const campaign of campJson.data) {
        if (campaign.status === 'PAUSED') {
          console.log(`广告系列 ${campaign.name} 已是暂停状态，跳过`);
          continue;
        }

        // 检查表现，决定是否强制暂停
        const shouldPause = await checkCampaignPerformance(campaign.id);

        // 若时段本身要求暂停，或表现不达标，则暂停
        const finalStatus = (shouldPause || status === 'PAUSED') ? 'PAUSED' : 'ACTIVE';

        if (shouldPause) {
          console.log(`🛑 表现不达标，强制暂停: ${campaign.name}`);
        } else if (status === 'PAUSED') {
          console.log(`🕐 非投放时段，暂停: ${campaign.name}`);
        }

        // 更新广告系列状态
        const updateRes = await fetch(`https://graph.facebook.com/v20.0/${campaign.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: finalStatus,
            access_token: TOKEN
          })
        });
        const updateJson = await updateRes.json();
        console.log(`已更新广告系列: ${campaign.name} → ${finalStatus} | 结果: ${JSON.stringify(updateJson)}`);
        await new Promise(r => setTimeout(r, 500));
      }

      // 同步更新广告组预算（仅时段控制，跳过已暂停的广告组）
      const adsetRes = await fetch(
        `https://graph.facebook.com/v20.0/${accountId.trim()}/adsets?fields=id,name,status&access_token=${TOKEN}`
      );
      const adsetJson = await adsetRes.json();

      if (!adsetJson.data || !Array.isArray(adsetJson.data)) continue;

      for (const adset of adsetJson.data) {
        if (adset.status === 'PAUSED') {
          console.log(`广告组 ${adset.name} 已暂停，跳过预算更新`);
          continue;
        }
        await fetch(`https://graph.facebook.com/v20.0/${adset.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            daily_budget: budget,
            access_token: TOKEN
          })
        });
        await new Promise(r => setTimeout(r, 500));
      }

    } catch (e) {
      console.error(`账户 ${accountId} 出错:`, e.message);
    }
  }
}

run();
