// ============================================================
// LINE LIFF 仮予約システム - GAS バックエンド
// スクリプトプロパティ設定:
//   SPREADSHEET_ID          : スプレッドシートID
//   LINE_CHANNEL_ACCESS_TOKEN: LINEチャネルアクセストークン
//   ADMIN_EMAIL             : 管理者メールアドレス
// ============================================================

const PROPS = PropertiesService.getScriptProperties();

// ── GET: 医院情報を返す ─────────────────────────────────────
function doGet(e) {
  const callback  = e.parameter.callback;   // JSONP 対応
  const clinicId  = e.parameter.clinic_id;

  try {
    if (!clinicId) throw new Error('clinic_id が指定されていません');

    const ss    = SpreadsheetApp.openById(PROPS.getProperty('SPREADSHEET_ID'));
    const sheet = ss.getSheetByName('clinics');
    if (!sheet) throw new Error('clinics シートが見つかりません');

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];

    let clinic = null;
    for (let i = 1; i < data.length; i++) {
      const row = {};
      headers.forEach((h, j) => { row[h] = data[i][j]; });
      if (String(row['clinic_id']).trim() === String(clinicId).trim()) {
        clinic = row;
        break;
      }
    }

    if (!clinic) throw new Error('指定された医院が見つかりません: ' + clinicId);

    // スケジュール文字列をパース → [{start:'9:00', end:'13:00'}, ...]
    clinic['schedule_parsed'] = parseSchedule(String(clinic['schedule'] || ''));

    // 診療科目をカンマ分割 → 配列
    clinic['treatments_array'] = parseCsvColumn(String(clinic['treatments'] || ''));

    // 休診曜日をカンマ分割 → 数値配列 (0=日, 6=土)
    clinic['closed_days_array'] = parseCsvColumn(String(clinic['closed_days'] || ''))
                                    .map(Number)
                                    .filter(n => !isNaN(n));

    return buildResponse({ success: true, clinic: clinic }, callback);

  } catch (err) {
    return buildResponse({ success: false, error: err.message }, callback);
  }
}

// ── POST: 予約データを受け取り書き込み + 通知 ─────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 最大30秒待機

    const body = JSON.parse(e.postData.contents);
    console.log('受信データ:', JSON.stringify(body));
    validatePost(body);

    const ss    = SpreadsheetApp.openById(PROPS.getProperty('SPREADSHEET_ID'));
    const sheet = ss.getSheetByName('reservations');
    if (!sheet) throw new Error('reservations シートが見つかりません');

    const now           = new Date();
    const reservationId = 'R' + now.getTime();

    sheet.appendRow([
      reservationId,
      Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
      body.clinic_id        || '',
      body.line_user_id     || '',
      body.name,
      body.phone,
      body.date,
      body.time,
      body.date2            || '',
      body.time2            || '',
      body.date3            || '',
      body.time3            || '',
      body.visit_type       || '',
      body.treatment        || '',
      body.symptoms         || '',
      '仮予約',
    ]);

    // clinics シートから医院情報を取得
    const clinicsSheet = ss.getSheetByName('clinics');
    let clinicName  = '';
    let clinicPhone = '';
    if (clinicsSheet && body.clinic_id) {
      const clinicData    = clinicsSheet.getDataRange().getValues();
      const clinicHeaders = clinicData[0];
      const idCol         = clinicHeaders.indexOf('clinic_id');
      const nameCol       = clinicHeaders.indexOf('clinic_name');
      const phoneCol      = clinicHeaders.indexOf('clinic_phone');
      for (let i = 1; i < clinicData.length; i++) {
        if (String(clinicData[i][idCol]).trim() === String(body.clinic_id).trim()) {
          clinicName  = String(clinicData[i][nameCol]  || '');
          clinicPhone = String(clinicData[i][phoneCol] || '');
          break;
        }
      }
    }

    // LINE Push Message
    const token = PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    console.log('[LINE] line_user_id: ' + (body.line_user_id ? body.line_user_id : '（空）'));
    console.log('[LINE] TOKEN 設定: ' + (token ? 'あり（先頭10文字: ' + token.slice(0, 10) + '…）' : 'なし（未設定）'));
    if (body.line_user_id && token) {
      sendLinePushMessage(body.line_user_id, body, reservationId, token, clinicName, clinicPhone);
    } else {
      console.log('[LINE] Push Message スキップ: ' +
        (!body.line_user_id ? 'line_user_id が空' : 'TOKEN が未設定'));
    }

    // 管理者メール通知
    const adminEmail = PROPS.getProperty('ADMIN_EMAIL');
    if (adminEmail) {
      sendAdminEmail(body, reservationId, adminEmail);
    }

    return buildResponse({ success: true, reservation_id: reservationId });

  } catch (err) {
    return buildResponse({ success: false, error: err.message });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ── LINE Push Message ────────────────────────────────────────
function sendLinePushMessage(userId, data, reservationId, token, clinicName, clinicPhone) {
  const treatmentLabel = getTreatmentLabel(data.treatment);
  const visitLabel     = data.visit_type === 'first' ? '初診' : '再診';

  const text =
    '【仮予約受付完了】\n' +
    (clinicName  ? `医院名：${clinicName}\n`         : '') +
    (clinicPhone ? `医院電話番号：${clinicPhone}\n`  : '') +
    '━━━━━━━━━━━━━━━\n' +
    `予約ID : ${reservationId}\n` +
    `お名前 : ${data.name} 様\n` +
    `電話番号: ${data.phone}\n` +
    `第1希望: ${data.date} ${data.time}\n` +
    (data.date2 ? `第2希望: ${data.date2} ${data.time2}\n` : '') +
    (data.date3 ? `第3希望: ${data.date3} ${data.time3}\n` : '') +
    `区　分 : ${visitLabel}\n` +
    `診療科目: ${treatmentLabel}\n` +
    (data.symptoms ? `相談内容: ${data.symptoms}\n` : '') +
    '━━━━━━━━━━━━━━━\n' +
    '※こちらは仮予約です。\n' +
    '医院よりご確認のご連絡をさせていただきます。\n' +
    'ご不明な点はお電話でお問い合わせください。';

  const payload = {
    to: userId,
    messages: [{ type: 'text', text: text }],
  };

  console.log('[LINE] Push Message 送信開始 userId=' + userId);
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method      : 'post',
      contentType : 'application/json',
      headers     : { 'Authorization': 'Bearer ' + token },
      payload     : JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code    = res.getResponseCode();
    const resBody = res.getContentText();
    console.log('[LINE] レスポンスコード: ' + code);
    console.log('[LINE] レスポンスボディ: ' + resBody);
    if (code !== 200) {
      console.log('[LINE] ERROR: Push Message 失敗 code=' + code + ' body=' + resBody);
    } else {
      console.log('[LINE] Push Message 送信成功');
    }
  } catch (e) {
    console.log('[LINE] 例外発生: ' + e.message);
  }
}

// ── 管理者メール通知 ────────────────────────────────────────
function sendAdminEmail(data, reservationId, adminEmail) {
  const subject = `【仮予約通知】${data.name} 様 ${data.date} ${data.time}`;
  const spreadsheetUrl =
    'https://docs.google.com/spreadsheets/d/' +
    PROPS.getProperty('SPREADSHEET_ID');

  const body =
    `新しい仮予約を受け付けました。\n\n` +
    `予約ID   : ${reservationId}\n` +
    `医院ID   : ${data.clinic_id || '（不明）'}\n` +
    `お名前   : ${data.name}\n` +
    `電話番号 : ${data.phone}\n` +
    `希望日   : ${data.date}\n` +
    `希望時間 : ${data.time}\n` +
    `初診/再診: ${data.visit_type === 'first' ? '初診' : '再診'}\n` +
    `診療科目 : ${getTreatmentLabel(data.treatment)}\n` +
    `相談内容 : ${data.symptoms || '（なし）'}\n` +
    `LINEユーザーID: ${data.line_user_id || '（未取得）'}\n\n` +
    `スプレッドシートで確認:\n${spreadsheetUrl}`;

  GmailApp.sendEmail(adminEmail, subject, body);
}

// ── スプレッドシート初期セットアップ ─────────────────────────
function setupSpreadsheet() {
  const spreadsheetId = PROPS.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    Logger.log('ERROR: スクリプトプロパティに SPREADSHEET_ID を設定してください');
    return;
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);

  // ── clinics シート ──
  let clinicsSheet = ss.getSheetByName('clinics');
  if (!clinicsSheet) {
    clinicsSheet = ss.insertSheet('clinics');
    Logger.log('clinics シートを作成しました');
  }
  if (clinicsSheet.getLastRow() === 0) {
    const clinicsHeaders = [
      'clinic_id',    // 医院ID (例: clinic001)
      'clinic_name',  // 医院名
      'address',      // 住所
      'clinic_phone', // 電話番号
      'hp_url',       // ホームページURL
      'closed_days',  // 休診曜日 カンマ区切り (0=日,1=月,...,6=土)
      'schedule',     // 診療時間 "9:00-13:00,14:30-19:00" 形式
      'treatments',   // 診療科目 カンマ区切り (general,preventive,other 等)
    ];
    clinicsSheet.appendRow(clinicsHeaders);

    // サンプルデータ
    clinicsSheet.appendRow([
      'clinic001',
      'サンプル歯科クリニック',
      '東京都渋谷区〇〇1-2-3',
      '03-1234-5678',
      'https://example.com',
      '0,6',                          // 日・土が休診
      '9:00-13:00,14:30-19:00',       // 昼休み 13:00-14:30
      'general,preventive,orthodontics,other',
    ]);
    Logger.log('clinics シートにヘッダーとサンプルデータを追加しました');
  }

  // ── reservations シート ──
  let reservationsSheet = ss.getSheetByName('reservations');
  if (!reservationsSheet) {
    reservationsSheet = ss.insertSheet('reservations');
    Logger.log('reservations シートを作成しました');
  }
  if (reservationsSheet.getLastRow() === 0) {
    const reservationsHeaders = [
      'reservation_id', // 予約ID
      'timestamp',      // 受付日時
      'clinic_id',      // 医院ID
      'line_user_id',   // LINEユーザーID
      'name',           // 患者氏名
      'phone',          // 電話番号
      'date',           // 第1希望日
      'time',           // 第1希望時間
      'date2',          // 第2希望日
      'time2',          // 第2希望時間
      'date3',          // 第3希望日
      'time3',          // 第3希望時間
      'visit_type',     // 初診/再診 (first/revisit)
      'treatment',      // 診療科目
      'symptoms',       // 症状・相談内容
      'status',         // ステータス (仮予約/確定/キャンセル)
    ];
    reservationsSheet.appendRow(reservationsHeaders);
    Logger.log('reservations シートにヘッダーを追加しました');
  }

  Logger.log('setupSpreadsheet() 完了');
}

// ── ヘルパー関数 ─────────────────────────────────────────────

/**
 * スケジュール文字列をパース
 * "9:00-13:00,14:30-19:00" → [{start:'9:00', end:'13:00'}, {start:'14:30', end:'19:00'}]
 */
function parseSchedule(scheduleStr) {
  if (!scheduleStr || scheduleStr.trim() === '') return [];
  return scheduleStr.split(',').map(function(range) {
    const parts = range.trim().split('-');
    return { start: (parts[0] || '').trim(), end: (parts[1] || '').trim() };
  }).filter(function(r) { return r.start && r.end; });
}

/**
 * カンマ区切り文字列を配列に変換（空文字列は除外）
 */
function parseCsvColumn(str) {
  if (!str || str.trim() === '') return [];
  return str.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

/**
 * 診療科目コードを日本語ラベルに変換
 */
function getTreatmentLabel(code) {
  const map = {
    'general'      : '一般診療',
    'preventive'   : '予防・クリーニング',
    'orthodontics' : '矯正歯科',
    'oral_surgery' : '口腔外科',
    'pediatric'    : '小児歯科',
    'whitening'    : 'ホワイトニング',
    'implant'      : 'インプラント',
    'other'        : 'その他',
  };
  return map[code] || code;
}

/**
 * POSTボディの必須項目チェック
 */
function validatePost(body) {
  const required = ['name', 'phone', 'date', 'time', 'treatment'];
  required.forEach(function(key) {
    if (!body[key] || String(body[key]).trim() === '') {
      throw new Error('必須項目が不足しています: ' + key);
    }
  });
  // その他を選択した場合は symptoms が必須
  if (body.treatment === 'other' && !body.symptoms) {
    throw new Error('診療科目が「その他」の場合は症状・相談内容が必須です');
  }
}

/**
 * JSON/JSONP レスポンスを生成
 */
function buildResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── テスト用: GAS エディタから直接 doPost を実行する ────────────
function testDoPost() {
  const e = {
    postData: {
      contents: JSON.stringify({
        clinic_id    : 'clinic001',
        line_user_id : 'U925e333d6e740ec78963c46b164b4d9a',
        name         : 'テスト 太郎',
        phone        : '090-0000-0000',
        date         : '2026-05-25',
        time         : '10:00',
        visit_type   : 'first',
        treatment    : 'general',
        symptoms     : ''
      })
    }
  };
  const result = doPost(e);
  console.log('testDoPost result: ' + result.getContent());
}
