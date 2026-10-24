/**
 * 章节数据 — 所有页面统一引用此文件
 * 添加新章节时只需修改此处的 CHAPTERS 数组：
 *   num    章号
 *   title  章标题（目录/顶栏/摘句来源均用它）
 *   file   章节文件名
 *   words  字数（目录与进度计算用）
 *   blurb  目录页的一句话简介
 *   year   故事内年份，写成四位数字（如 2022）。首页光阴册据此推出年级与学期，
 *          分隔条显示成「二〇二二 · 高一上」；留空则不分段
 *   date   故事内日期（首页光阴目录与章节页落款用，如「九月二十七」）。
 *          月份会被用来判断上学/下学期：9 月–次年 1 月为「上」，2–8 月为「下」
 *   term   学期标签（可选，如「高一上」）。只有自动推算的年级不对时才需要手写
 *   dates  一章里有多个日期时用数组，按先后写（如 ['九月一日','九月二十七']），
 *          首页显示成区间「九月一日–二十七」，学期归属按第一个日期算；
 *          只有一天时用 date 就行，两个字段二选一
 *   seal   章末印章文字（两字，如「前桌」）
 *   leaf   梧桐叶位（0-7，首页进度带点亮第几片叶；章节多时环形扩容）
 *   volume 卷名（可选；当出现 ≥2 个不同卷名时，目录自动按卷分组）
 */
// 高一入学的那一年（故事第一年秋天的年份）。年级由它往后推：
// 2022 → 高一、2023 → 高二、2024 → 高三。推到高中以外就不再标学期，只显示年份。
var COHORT_YEAR = 2022;

var CHAPTERS = [
  { num: 1, title: '第一章·临渊羡鱼', file: 'chapter-01.html', words: 2722, blurb: '所有的事都还没开始，一切都还来得及。', year: 2022, dates: ['九月一日', '九月十七'], seal: '临渊', leaf: 0 },
  { num: 2, title: '第二章·前桌', file: 'chapter-02.html', words: 2257, blurb: '有些位置只是前后桌，有些位置会慢慢变得不同。', year: 2022, date: '九月十九', seal: '前桌', leaf: 1 },
  { num: 3, title: '第三章·课上', file: 'chapter-03.html', words: 1999, blurb: '有些课要站起来回答，有些事要站起来走过去。', year: 2022, date: '九月十九', seal: '课上', leaf: 2 },
  { num: 4, title: '第四章·身位', file: 'chapter-04.html', words: 2451, blurb: '有些距离不用说出来，走近两三步就够了。', year: 2022, date: '九月十九', seal: '身位', leaf: 3 },
  { num: 5, title: '第五章·板报', file: 'chapter-05.html', words: 2013, blurb: '有些界线不用争，往旁边挪两指，字照样写得直。', year: 2022, date: '九月二十七', seal: '板报', leaf: 4 }
];

function getChapterStorageId(href) {
  var path = '/novel/' + href;
  return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}
