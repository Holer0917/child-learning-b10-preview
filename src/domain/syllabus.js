/**
 * 知识点大纲 —— 1~3 年级口算知识点定义
 *
 * 这是整个出题系统的"知识来源"。每个知识点 = 元数据 + 一份 spec（数值约束规格）。
 * 出题引擎（generator.js）是通用的，它只消费 spec，不认识具体知识点，
 * 因此**新增一个知识点只需在下方 SYLLABUS 中追加一条记录**，
 * 无需改动引擎的任何一行代码（对应需求 NFR-07 第 2 条）。
 *
 * spec 字段说明：
 *   op       运算类型：add | sub | mul | div | mix | compare
 *   kind     数值种类：int | fraction | decimal
 *   a, b     操作数取值范围（闭区间）
 *   result   结果取值范围
 *   carry    加法是否强制进位（true 强制，false 禁止）
 *   borrow   减法是否强制退位
 *   remainder 除法是否允许余数
 *   quotient 除法商的取值范围
 *   quotientHasZero 商是否必须含 0（对应"商中间/末尾有 0 的除法"）
 *   denom    同分母分数的分母范围
 *   scale    小数位数
 *   pattern  混合运算的运算符模式，如 ['+','-']
 *   paren    混合运算是否含括号
 *   c        混合运算第三个数范围
 */

/* ------------------------------------------------------------------ *
 * 年级
 * ------------------------------------------------------------------ */

export const GRADES = [
  { id: 1, name: '一年级', desc: '10/20 以内加减法、100 以内数的认识' },
  { id: 2, name: '二年级', desc: '表内乘除法、100 以内进退位加减' },
  { id: 3, name: '三年级', desc: '多位数乘除、混合运算、分数与小数初步' }
];

/* ------------------------------------------------------------------ *
 * 题型
 * ------------------------------------------------------------------ */

export const QUESTION_TYPES = [
  { id: 'horizontal', name: '横式',   desc: '37 + 25 = ___' },
  { id: 'vertical',   name: '竖式',   desc: '数字上下对齐的笔算格式' },
  { id: 'compare',    name: '比较大小', desc: '37 + 25 ○ 60' },
  { id: 'fill',       name: '填空',   desc: '□ + 25 = 62' },
  { id: 'chain',      name: '连算',   desc: '12 + 8 - 5 = ___' }
];

/* ------------------------------------------------------------------ *
 * 知识点大纲（24 个）
 * ------------------------------------------------------------------ */

export const SYLLABUS = [
  /* ============ 一年级 ============ */
  {
    id: 'G1-01', grade: 1, order: 1, difficulty: 1,
    name: '10 以内加法',
    desc: '两个一位数相加，结果不超过 10。这是全部计算能力的地基。',
    types: ['horizontal', 'fill', 'compare'],
    spec: {
      op: 'add', kind: 'int',
      a: { min: 1, max: 9 }, b: { min: 1, max: 9 },
      result: { min: 2, max: 10 }
    }
  },
  {
    id: 'G1-02', grade: 1, order: 2, difficulty: 1,
    name: '10 以内减法',
    desc: '被减数不超过 10 的减法，结果不为负。',
    types: ['horizontal', 'fill', 'compare'],
    spec: {
      op: 'sub', kind: 'int',
      a: { min: 2, max: 10 }, b: { min: 1, max: 9 },
      result: { min: 0, max: 9 }
    }
  },
  {
    id: 'G1-03', grade: 1, order: 3, difficulty: 2,
    name: '20 以内进位加法',
    desc: '个位相加满十要向十位进一，如 8 + 7。一年级上学期的重点与难点。',
    types: ['horizontal', 'vertical', 'fill'],
    spec: {
      op: 'add', kind: 'int', carry: true,
      a: { min: 2, max: 9 }, b: { min: 2, max: 9 },
      result: { min: 11, max: 20 }
    }
  },
  {
    id: 'G1-04', grade: 1, order: 4, difficulty: 2,
    name: '20 以内退位减法',
    desc: '个位不够减要从十位退一，如 13 − 7。',
    types: ['horizontal', 'vertical', 'fill'],
    spec: {
      op: 'sub', kind: 'int', borrow: true,
      a: { min: 11, max: 18 }, b: { min: 2, max: 9 },
      result: { min: 1, max: 9 }
    }
  },
  {
    id: 'G1-05', grade: 1, order: 5, difficulty: 1,
    name: '100 以内整十数加减',
    desc: '两个整十数相加或相减，如 30 + 40。',
    types: ['horizontal', 'fill', 'compare'],
    spec: {
      op: 'addSub', kind: 'int', step: 10,
      a: { min: 10, max: 90 }, b: { min: 10, max: 90 },
      result: { min: 10, max: 100 }
    }
  },
  {
    id: 'G1-06', grade: 1, order: 6, difficulty: 2,
    name: '两位数加减一位数（不进位/不退位）',
    desc: '个位直接相加或相减，不需要进位或退位，如 34 + 5。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'addSub', kind: 'int', strictNoCarry: true,
      a: { min: 10, max: 99 }, b: { min: 1, max: 9 },
      result: { min: 1, max: 100 }
    }
  },
  {
    id: 'G1-07', grade: 1, order: 7, difficulty: 2,
    name: '两位数加减整十数',
    desc: '如 45 + 30、78 − 20，是后续两位数笔算的基础。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'addSub', kind: 'int', stepB: 10,
      a: { min: 10, max: 99 }, b: { min: 10, max: 90 },
      result: { min: 1, max: 100 }
    }
  },
  {
    id: 'G1-08', grade: 1, order: 8, difficulty: 1,
    name: '100 以内数的认识与比较',
    desc: '比较两个 100 以内数的大小，巩固数位概念。',
    types: ['compare'],
    spec: {
      op: 'compare', kind: 'int',
      a: { min: 1, max: 100 }, b: { min: 1, max: 100 }
    }
  },

  /* ============ 二年级 ============ */
  {
    id: 'G2-01', grade: 2, order: 1, difficulty: 2,
    name: '100 以内两位数加法（进位）',
    desc: '个位相加满十，要向十位进一，如 47 + 38。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'add', kind: 'int', carry: true,
      a: { min: 10, max: 89 }, b: { min: 10, max: 89 },
      result: { min: 21, max: 100 }
    }
  },
  {
    id: 'G2-02', grade: 2, order: 2, difficulty: 2,
    name: '100 以内两位数减法（退位）',
    desc: '个位不够减，要从十位退一，如 62 − 47。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'sub', kind: 'int', borrow: true,
      a: { min: 21, max: 99 }, b: { min: 11, max: 89 },
      result: { min: 1, max: 88 }
    }
  },
  {
    id: 'G2-03', grade: 2, order: 3, difficulty: 2,
    name: '表内乘法',
    desc: '2~9 的乘法口诀，要求达到脱口而出的熟练度。',
    types: ['horizontal', 'fill'],
    spec: {
      op: 'mul', kind: 'int',
      a: { min: 2, max: 9 }, b: { min: 2, max: 9 }
    }
  },
  {
    id: 'G2-04', grade: 2, order: 4, difficulty: 2,
    name: '表内除法',
    desc: '用乘法口诀求商，被除数不超过 81，结果无余数。',
    types: ['horizontal', 'fill'],
    spec: {
      op: 'div', kind: 'int', remainder: false,
      b: { min: 2, max: 9 },
      quotient: { min: 2, max: 9 }
    }
  },
  {
    id: 'G2-05', grade: 2, order: 5, difficulty: 3,
    name: '乘加乘减混合',
    desc: '先乘后加减，如 6 × 7 + 12。',
    types: ['horizontal', 'chain'],
    spec: {
      op: 'mix', kind: 'int',
      a: { min: 2, max: 9 }, b: { min: 2, max: 9 },
      c: { min: 1, max: 20 },
      pattern: ['×', ['+', '-']],          // 乘加或乘减，随机决定
      result: { min: 1, max: 100 }
    }
  },
  {
    id: 'G2-06', grade: 2, order: 6, difficulty: 2,
    name: '万以内数的认识与比较',
    desc: '比较四位数的大小，理解数位顺序。',
    types: ['compare'],
    spec: {
      op: 'compare', kind: 'int',
      a: { min: 100, max: 9999 }, b: { min: 100, max: 9999 }
    }
  },
  {
    id: 'G2-07', grade: 2, order: 7, difficulty: 2,
    name: '整百整千数加减',
    desc: '如 300 + 500、2000 − 800，是万以内笔算的铺垫。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'addSub', kind: 'int', step: 100,
      a: { min: 100, max: 9000 }, b: { min: 100, max: 9000 },
      result: { min: 100, max: 9999 }
    }
  },
  {
    id: 'G2-08', grade: 2, order: 8, difficulty: 3,
    name: '100 以内加减混合',
    desc: '连续两次加减，中间结果不得为负，如 45 + 38 − 27。',
    types: ['horizontal', 'chain'],
    spec: {
      op: 'mix', kind: 'int', pattern: ['+', '-'],
      a: { min: 10, max: 99 }, b: { min: 10, max: 60 },
      c: { min: 5, max: 60 },
      result: { min: 1, max: 100 }
    }
  },

  /* ============ 三年级 ============ */
  {
    id: 'G3-01', grade: 3, order: 1, difficulty: 3,
    name: '多位数乘一位数',
    desc: '三位数乘一位数，需要连续进位，如 156 × 4。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'mul', kind: 'int',
      a: { min: 100, max: 999 }, b: { min: 2, max: 9 }
    }
  },
  {
    id: 'G3-02', grade: 3, order: 2, difficulty: 3,
    name: '两位数乘两位数',
    desc: '需要两次部分积再相加，如 24 × 13。',
    types: ['vertical', 'horizontal'],
    spec: {
      op: 'mul', kind: 'int',
      a: { min: 11, max: 99 }, b: { min: 11, max: 99 }
    }
  },
  {
    id: 'G3-03', grade: 3, order: 3, difficulty: 3,
    name: '除数是一位数的除法',
    desc: '从高位除起，逐位求商，如 408 ÷ 4。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'div', kind: 'int', remainder: false,
      b: { min: 2, max: 9 },
      quotient: { min: 10, max: 999 }
    }
  },
  {
    id: 'G3-04', grade: 3, order: 4, difficulty: 3,
    name: '商中间或末尾有 0 的除法',
    desc: '商的十进制表示中含 0，是最容易出错的一类除法。',
    types: ['vertical', 'horizontal'],
    spec: {
      op: 'div', kind: 'int', remainder: false, quotientHasZero: true,
      b: { min: 2, max: 9 },
      quotient: { min: 100, max: 999 }
    }
  },
  {
    id: 'G3-05', grade: 3, order: 5, difficulty: 3,
    name: '两位数除以一位数（有余数）',
    desc: '不能整除，需要写出余数，如 47 ÷ 5 = 9 余 2。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'div', kind: 'int', remainder: true,
      a: { min: 10, max: 99 }, b: { min: 2, max: 9 },
      quotient: { min: 2, max: 40 }
    }
  },
  {
    id: 'G3-06', grade: 3, order: 6, difficulty: 3,
    name: '两步混合运算（含括号）',
    desc: '含括号的混合运算，先算括号内，如 (45 + 27) ÷ 9。',
    types: ['horizontal', 'chain'],
    spec: {
      op: 'mix', kind: 'int', paren: true,
      pattern: ['+', '÷'],
      a: { min: 10, max: 90 }, b: { min: 5, max: 60 },
      c: { min: 2, max: 9 },
      result: { min: 1, max: 100 }
    }
  },
  {
    id: 'G3-07', grade: 3, order: 7, difficulty: 2,
    name: '同分母分数加减法',
    desc: '分母不超过 10，结果要约成最简分数，如 2/7 + 3/7 = 5/7。',
    types: ['horizontal'],
    spec: {
      op: 'addSub', kind: 'fraction',
      denom: { min: 3, max: 10 }
    }
  },
  {
    id: 'G3-08', grade: 3, order: 8, difficulty: 3,
    name: '一位小数加减法',
    desc: '小数点对齐后相加减，如 3.5 + 1.8。',
    types: ['horizontal', 'vertical'],
    spec: {
      op: 'addSub', kind: 'decimal', scale: 1,
      a: { min: 1, max: 99 }, b: { min: 1, max: 99 },
      result: { min: 0.1, max: 100 }
    }
  }
];

/* ------------------------------------------------------------------ *
 * 查询接口
 * ------------------------------------------------------------------ */

/** 全部知识点（可按年级筛选） */
export function getKnowledgePoints(grade) {
  return grade ? SYLLABUS.filter((k) => k.grade === Number(grade)) : SYLLABUS.slice();
}

/** 按编号取单个知识点 */
export function getKnowledgePoint(id) {
  return SYLLABUS.find((k) => k.id === id) ?? null;
}

/** 按名称取（用于导入数据时容错） */
export function getKnowledgePointByName(name) {
  return SYLLABUS.find((k) => k.name === name) ?? null;
}

/**
 * 组合筛选
 * @param {{grade?:number, keyword?:string, type?:string, maxDifficulty?:number}} opts
 */
export function filterKnowledgePoints({ grade, keyword, type, maxDifficulty } = {}) {
  const kw = keyword ? String(keyword).trim().toLowerCase() : '';
  return SYLLABUS.filter((k) =>
    (!grade || k.grade === Number(grade)) &&
    (!type || k.types.includes(type)) &&
    (!maxDifficulty || k.difficulty <= maxDifficulty) &&
    (!kw || k.name.toLowerCase().includes(kw) || k.desc.toLowerCase().includes(kw))
  );
}

/** 该年级的默认知识点编号列表（默认全选） */
export function getGradeDefaultKPs(grade) {
  return getKnowledgePoints(grade).map((k) => k.id);
}

/** 按年级分组，供知识点选择页渲染 */
export function groupByGrade(kps = SYLLABUS) {
  return GRADES.map((g) => ({
    ...g,
    points: kps.filter((k) => k.grade === g.id)
  }));
}

/** 某个知识点支持的题型（求多个知识点的交集，用于筛选可选题型） */
export function commonTypes(kpIds) {
  if (!kpIds || kpIds.length === 0) return QUESTION_TYPES.map((t) => t.id);
  const sets = kpIds
    .map((id) => getKnowledgePoint(id)?.types ?? [])
    .filter((arr) => arr.length > 0);
  if (sets.length === 0) return QUESTION_TYPES.map((t) => t.id);
  return sets.reduce((acc, cur) => acc.filter((t) => cur.includes(t)));
}

/** 统计信息 */
export function syllabusStats() {
  return {
    total: SYLLABUS.length,
    byGrade: GRADES.map((g) => ({
      grade: g.id,
      name: g.name,
      count: SYLLABUS.filter((k) => k.grade === g.id).length
    }))
  };
}
