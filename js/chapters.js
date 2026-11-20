/* 章节数据 — 所有页面统一引用此文件
   设计说明、历史与踩坑记录见 _design/notes/chapters.js.md（原文按行号归档）。 */
// 高一入学的那一年（故事第一年秋天的年份）。年级由它往后推：
// 2022 → 高一、2023 → 高二、2024 → 高三。推到高中以外就不再标学期，只显示年份。
var COHORT_YEAR = 2022;

var CHAPTERS = [
  { num: 1, title: '第一章·临渊羡鱼', file: 'chapter-01.html', words: 3043, blurb: '所有的事都还没开始，一切都还来得及。', year: 2022, dates: ['九月一日', '九月十七'], seal: '临渊', leaf: 0, updated: '2026-11-14' },
  { num: 2, title: '第二章·前桌', file: 'chapter-02.html', words: 2553, blurb: '有些位置只是前后桌，有些位置会慢慢变得不同。', year: 2022, date: '九月十九', seal: '前桌', leaf: 1, updated: '2026-11-14' },
  { num: 3, title: '第三章·课上', file: 'chapter-03.html', words: 2074, blurb: '有些课要站起来回答，有些事要站起来走过去。', year: 2022, date: '九月十九', seal: '课上', leaf: 2, updated: '2026-11-14' },
  { num: 4, title: '第四章·身位', file: 'chapter-04.html', words: 2451, blurb: '有些距离不用说出来，走近两三步就够了。', year: 2022, date: '九月十九', seal: '身位', leaf: 3, updated: '2026-10-24' },
  { num: 5, title: '第五章·板报', file: 'chapter-05.html', words: 2013, blurb: '有些界线不用争，往旁边挪两指，字照样写得直。', year: 2022, date: '九月二十', seal: '板报', leaf: 4, updated: '2026-10-25' },
  { num: 6, title: '第六章·越界', file: 'chapter-06.html', words: 2184, blurb: '有些界线退得干干净净，有些习惯退不回去。', year: 2022, date: '九月二十', seal: '越界', leaf: 5, updated: '2026-10-25' },
  { num: 7, title: '第七章·余响', file: 'chapter-07.html', words: 2022, blurb: '有些声音传得比名次远，有些诺言一直没过期。', year: 2022, date: '九月二十六', seal: '余响', leaf: 6, updated: '2026-10-25' },
  { num: 8, title: '第八章·前奏', file: 'chapter-08.html', words: 2339, blurb: '有些课在假期前没人听得进去，有些故事在校门口等着人捡。', year: 2022, date: '九月三十', seal: '前奏', leaf: 7, updated: '2026-11-01' },
  { num: 9, title: '第九章·旧钢笔', file: 'chapter-09.html', words: 2134, blurb: '有些东西丢了能找回来，有些名字只喊给自己听。', year: 2022, date: '九月三十', seal: '钢笔', leaf: 0, updated: '2026-11-01' },
  { num: 10, title: '第十章·两家一家', file: 'chapter-10.html', words: 2463, blurb: '有些饭两家吃了十几年，有些人早就是一家人。', year: 2022, date: '九月三十', seal: '一家', leaf: 1, updated: '2026-11-08' },
  { num: 11, title: '第十一章·晚饭', file: 'chapter-11.html', words: 3240, blurb: '有些碗筷多摆一副，有些人隔着两千公里也算在场。', year: 2022, date: '九月三十', seal: '晚饭', leaf: 2, updated: '2026-11-10' }
];

function getChapterStorageId(href) {
  var path = '/novel/' + href;
  return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}
