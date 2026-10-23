/**
 * 章节数据 — 所有页面统一引用此文件
 * 添加新章节时只需修改此处的 CHAPTERS 数组：
 *   num    章号
 *   title  章标题（目录/顶栏/摘句来源均用它）
 *   file   章节文件名
 *   words  字数（目录与进度计算用）
 *   blurb  目录页的一句话简介
 *   year   故事内年份（首页光阴册的年份分隔，如「二〇二二」；同一年只写一次，
 *          换年时新章写新值 → 光阴册自动多出一条年份横线。留空则退回不分年）
 *   date   故事内日期（首页光阴目录与章节页落款用，如「九月二十七」）
 *   seal   章末印章文字（两字，如「前桌」）
 *   leaf   梧桐叶位（0-7，首页进度带点亮第几片叶；章节多时环形扩容）
 *   volume 卷名（可选；当出现 ≥2 个不同卷名时，目录自动按卷分组）
 */
var CHAPTERS = [
  { num: 1, title: '第一章·临渊羡鱼', file: 'chapter-01.html', words: 2722, blurb: '所有的事都还没开始，一切都还来得及。', year: '二〇二二', date: '九月二十七', seal: '临渊', leaf: 0 },
  { num: 2, title: '第二章·前桌', file: 'chapter-02.html', words: 2257, blurb: '有些位置只是前后桌，有些位置会慢慢变得不同。', year: '二〇二二', date: '十月十日', seal: '前桌', leaf: 1 },
  { num: 3, title: '第三章·课上', file: 'chapter-03.html', words: 1999, blurb: '有些课要站起来回答，有些事要站起来走过去。', year: '二〇二二', date: '十月十日', seal: '课上', leaf: 2 }
];

function getChapterStorageId(href) {
  var path = '/novel/' + href;
  return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}
