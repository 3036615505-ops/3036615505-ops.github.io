/**
 * 章节数据 — 所有页面统一引用此文件
 * 添加新章节时只需修改此处的 CHAPTERS 数组：
 *   num    章号
 *   title  章标题（目录/顶栏/摘句来源均用它）
 *   file   章节文件名
 *   words  字数（目录与进度计算用）
 *   blurb  目录页的一句话简介
 */
var CHAPTERS = [
  { num: 1, title: '第一章·临渊羡鱼', file: 'chapter-01.html', words: 2722, blurb: '所有的事都还没开始，一切都还来得及。' },
  { num: 2, title: '第二章·前桌', file: 'chapter-02.html', words: 2257, blurb: '有些位置只是前后桌，有些位置会慢慢变得不同。' }
];

function getChapterStorageId(href) {
  var path = '/novel/' + href;
  return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}
