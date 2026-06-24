import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
// 静的ファイルを配信するフォルダを指定
app.use(express.static(path.join(__dirname, 'public')));

// D&D5EキャラクターシートのHTMLパースAPI
app.get('/api/parse', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URLを指定してください。' });
  }

  if (!url.startsWith('https://dndjp.sakura.ne.jp/')) {
    return res.status(400).json({ error: '無効なURLです。dndjp.sakura.ne.jpのキャラクターシートURLのみ対応しています。' });
  }

  try {
    console.log(`Fetching: ${url}`);
    const fetchResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!fetchResponse.ok) {
      return res.status(500).json({ error: `キャラクターシートの取得に失敗しました。ステータス: ${fetchResponse.status}` });
    }

    const buffer = await fetchResponse.arrayBuffer();
    // Shift_JISでデコード
    const decoder = new TextDecoder('shift_jis');
    const html = decoder.decode(buffer);

    // HTMLを正規表現でパース
    const data = parseCharacterSheet(html);
    
    // 出典URLをデータに追加
    data.sourceUrl = url;

    return res.json(data);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: `キャラクターシートの取得または解析に失敗しました: ${error.message}` });
  }
});

// HTML解析関数
function parseCharacterSheet(html) {
  const result = {
    characterName: '',
    race: '',
    classAndLevel: '',
    classes: [],
    hp: { max: 0 },
    initiative: 0,
    ac: 0,
    speed: '',
    passivePerception: 0,
    abilities: {
      str: { score: 10, modifier: 0, isProficient: false, saveBonus: 0 },
      dex: { score: 10, modifier: 0, isProficient: false, saveBonus: 0 },
      con: { score: 10, modifier: 0, isProficient: false, saveBonus: 0 },
      int: { score: 10, modifier: 0, isProficient: false, saveBonus: 0 },
      wis: { score: 10, modifier: 0, isProficient: false, saveBonus: 0 },
      cha: { score: 10, modifier: 0, isProficient: false, saveBonus: 0 }
    },
    skills: [],
    background: '',
    otherProficiencies: ''
  };

  // 1. キャラクター名
  const titleMatch = html.match(/<title>\s*([\s\S]*?)\s*<\/title>/i);
  if (titleMatch) {
    result.characterName = titleMatch[1].replace(/[\r\n\t]/g, '').trim();
  }

  // 2. 種族
  const raceMatch = html.match(/種族<BR>\s*<DIV class='B'><B>([^<]+)<\/B><\/DIV>/i);
  if (raceMatch) {
    result.race = raceMatch[1].trim();
  }

  // 3. クラス と レベル
  const classMatch = html.match(/クラス<BR>\s*<DIV class='B'><B>([^<]+)<\/B><\/DIV>/i);
  const levelMatch = html.match(/レベル<BR>\s*<DIV class='B'><B>([^<]+)<\/B><\/DIV>/i);
  if (classMatch && levelMatch) {
    const rawClass = classMatch[1].trim();
    const rawLevel = levelMatch[1].trim();

    // マルチクラス対応 (例: クラス "ドルイド/ウィザード", レベル "4/1" のような場合を分割)
    const classNames = rawClass.split(/[\/\,\+]/).map(s => s.trim());
    const levels = rawLevel.split(/[\/\,\+]/).map(s => parseInt(s.trim(), 10) || 0);

    const classesList = [];
    const parts = [];
    for (let i = 0; i < classNames.length; i++) {
      const className = classNames[i];
      const lvl = levels[i] || 0;
      if (className) {
        classesList.push({ className, level: lvl });
        parts.push(`${className} Lv.${lvl}`);
      }
    }
    result.classes = classesList;
    result.classAndLevel = parts.join(' / ');
  }

  // 4. AC (アーマークラス)
  const acTableMatch = html.match(/<table[^>]*summary=['"]ＡＣ['"][^>]*>([\s\S]*?)<\/table>/i);
  if (acTableMatch) {
    const acValMatch = acTableMatch[1].match(/<DIV class='A'><B>(\d+)<\/B><\/DIV>/i);
    if (acValMatch) {
      result.ac = parseInt(acValMatch[1], 10);
    }
  }

  // 5. イニシアティブ
  const initTableMatch = html.match(/<table[^>]*summary=['"]イニシアチブ['"][^>]*>([\s\S]*?)<\/table>/i);
  if (initTableMatch) {
    const initValMatch = initTableMatch[1].match(/<DIV class='A'><B>([^<]+)<\/B><\/DIV>/i);
    if (initValMatch) {
      const val = initValMatch[1].trim();
      result.initiative = parseInt(val, 10) || 0;
    }
  }

  // 6. 移動速度 (スピード)
  const speedTableMatch = html.match(/<table[^>]*summary=['"]スピード['"][^>]*>([\s\S]*?)<\/table>/i);
  if (speedTableMatch) {
    const speedValMatch = speedTableMatch[1].match(/<DIV class='A'><B>([^<]+)<\/B><\/DIV>/i);
    if (speedValMatch) {
      result.speed = speedValMatch[1].trim();
    }
  }

  // 7. HP (最大HP)
  const hpMaxMatch = html.match(/最大HP<\/TD>[\s\S]*?<DIV class='A'><B>(\d+)<\/B><\/DIV>/i);
  if (hpMaxMatch) {
    result.hp.max = parseInt(hpMaxMatch[1], 10);
  } else {
    const hpAltMatch = html.match(/最大HP[\s\S]*?<DIV class='A'><B>(\d+)<\/B><\/DIV>/i);
    if (hpAltMatch) {
      result.hp.max = parseInt(hpAltMatch[1], 10);
    }
  }

  // 8. 能力値 6種類
  const abilityTableMatch = html.match(/<table[^>]*summary=['"]能力値['"][^>]*>([\s\S]*?)<\/table>/i);
  if (abilityTableMatch) {
    const abilityContent = abilityTableMatch[1];
    const abilityMap = {
      '筋力': 'str', '敏捷力': 'dex', '耐久力': 'con',
      '知力': 'int', '判断力': 'wis', '魅力': 'cha'
    };

    const rows = abilityContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    rows.forEach(row => {
      const scoreM = row.match(/<DIV class='A'><B>(\d+)<\/B><\/DIV>/i);
      const nameM = row.match(/【(筋力|敏捷力|耐久力|知力|判断力|魅力)】/i);
      const modM = row.match(/<DIV class='B'><B>([^<]+)<\/B><\/DIV>/i);

      if (nameM && scoreM && modM) {
        const key = abilityMap[nameM[1]];
        if (key) {
          result.abilities[key].score = parseInt(scoreM[1], 10);
          const modStr = modM[1].trim();
          result.abilities[key].modifier = parseInt(modStr, 10) || 0;
        }
      }
    });
  }

  // 9. セーヴィング・スロー
  const saveSectionMatch = html.match(/セーヴィング・スロー[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i);
  if (saveSectionMatch) {
    const saveTableContent = saveSectionMatch[1];
    const rows = saveTableContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const saveMap = {
      '【筋力】': 'str', '【敏捷力】': 'dex', '【耐久力】': 'con',
      '【知力】': 'int', '【判断力】': 'wis', '【魅力】': 'cha'
    };

    rows.forEach(row => {
      const nameM = row.match(/(【筋力】|【敏捷力】|【耐久力】|【知力】|【判断力】|【魅力】)/i);
      if (nameM) {
        const key = saveMap[nameM[1]];
        if (key) {
          const saveBonusM = row.match(/<DIV class='A'><B>([^<]+)<\/B><\/DIV>/i);
          if (saveBonusM) {
            result.abilities[key].saveBonus = parseInt(saveBonusM[1].trim(), 10) || 0;
          }
          // 'レ' または '■' (u25a0) が含まれていれば習熟
          const isProf = /[\u30ec\u25a0]/.test(row);
          result.abilities[key].isProficient = isProf;
        }
      }
    });
  }

  // 10. 技能 (18種類)
  const skillsTableMatch = html.match(/<table[^>]*summary=['"]技能['"][^>]*>([\s\S]*?)<\/table>/i);
  if (skillsTableMatch) {
    const skillsContent = skillsTableMatch[1];
    const rows = skillsContent.match(/<TR[^>]*>[\s\S]*?<\/TR>/gi) || [];

    const skillList = [
      { name: '威圧', ability: 'CHA' }, { name: '医術', ability: 'WIS' }, { name: '運動', ability: 'STR' },
      { name: '隠密', ability: 'DEX' }, { name: '軽業', ability: 'DEX' }, { name: '看破', ability: 'WIS' },
      { name: '芸能', ability: 'CHA' }, { name: '自然', ability: 'INT' }, { name: '宗教', ability: 'INT' },
      { name: '生存', ability: 'WIS' }, { name: '説得', ability: 'CHA' }, { name: '捜査', ability: 'INT' },
      { name: '知覚', ability: 'WIS' }, { name: '手先の早業', ability: 'DEX' }, { name: '動物使い', ability: 'WIS' },
      { name: 'ペテン', ability: 'CHA' }, { name: '魔法学', ability: 'INT' }, { name: '歴史', ability: 'INT' }
    ];

    rows.forEach(row => {
      const nameM = row.match(/〈([^〉]+)〉/i);
      if (nameM) {
        const name = nameM[1].trim();
        const skillDef = skillList.find(s => s.name === name);
        if (skillDef) {
          const bonusM = row.match(/<DIV class='A'><B>([^<]+)<\/B><\/DIV>/i);
          const bonus = bonusM ? (parseInt(bonusM[1].trim(), 10) || 0) : 0;
          const isProf = /[\u30ec\u25a0]/.test(row);

          result.skills.push({
            name,
            ability: skillDef.ability,
            bonus,
            isProficient: isProf
          });
        }
      }
    });
  }

  // 11. 受動知覚
  const passiveMatch = html.match(/(?:PASSIVE WISDOM|受動【判断力】|受動〈知覚〉)[\s\S]*?<DIV class='A'><B>(\d+)<\/B><\/DIV>/i);
  if (passiveMatch) {
    result.passivePerception = parseInt(passiveMatch[1], 10);
  } else {
    const passiveAltMatch = html.match(/受動[\s\S]*?<DIV class='A'><B>(\d+)<\/B><\/DIV>/i);
    if (passiveAltMatch) {
      result.passivePerception = parseInt(passiveAltMatch[1], 10);
    }
  }

  // 12. 背景 (BACKGROUND)
  const bgMatch = html.match(/背景\s*BACK\s*GROUND[\s\S]*?<DIV class='C'>([\s\S]*?)<\/DIV>/i);
  if (bgMatch) {
    result.background = cleanHtmlText(bgMatch[1]);
  } else {
    const bgAltMatch = html.match(/背景[\s\S]*?BACK\s*GROUND[\s\S]*?<DIV class='C'>([\s\S]*?)<\/DIV>/i);
    if (bgAltMatch) {
      result.background = cleanHtmlText(bgAltMatch[1]);
    }
  }

  // 13. その他の習熟と言語 (OTHER PROFICIENCIES & LANGUAGES)
  const otherProfMatch = html.match(/summary=['"]その他の習熟と言語['"][\s\S]*?<DIV class='C'>([\s\S]*?)<\/DIV>/i);
  if (otherProfMatch) {
    result.otherProficiencies = cleanHtmlText(otherProfMatch[1]);
  } else {
    const otherProfAltMatch = html.match(/その他の習熟と言語[\s\S]*?<DIV class='C'>([\s\S]*?)<\/DIV>/i);
    if (otherProfAltMatch) {
      result.otherProficiencies = cleanHtmlText(otherProfAltMatch[1]);
    }
  }

  return result;
}

function cleanHtmlText(rawHtml) {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .trim();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
