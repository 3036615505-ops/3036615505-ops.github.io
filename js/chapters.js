/**
 * 章节数据 — 所有页面统一引用此文件
 * 添加新章节时只需修改此处的 CHAPTERS 数组
 */
var CHAPTERS = [
  { num: 1, title: '第一章·临渊羡鱼', file: 'chapter-01.html', words: 2722 },
  { num: 2, title: '第二章·前桌', file: 'chapter-02.html', words: 2257 }
];

function getChapterStorageId(href) {
  var path = '/novel/' + href;
  return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}
