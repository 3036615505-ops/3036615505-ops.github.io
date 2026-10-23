/**
 * 全局类型声明（只给 JSDoc 用，不产出任何代码）
 *
 * 阅读器的三个模块是「经典脚本 + window.LY 命名空间」，不是 ES 模块，
 * 所以共享类型只能声明在全局，靠 // @ts-check 在各自文件里引用。
 */

/** 阅读位置锚点：p 给人看，i/o 用来定位 */
type Anchor = {
  /** 进度百分比 0–100 */
  p: number;
  /** 第几段（0 起，按 .chapter-content p 的顺序） */
  i: number;
  /** 段内比例 0–1 */
  o: number;
};

/** 阅读足迹，也是备份导出的主体 */
type Footprints = {
  /** 读过书的日期，YYYY-M-D（不补零） */
  days: string[];
  /** 摘句 id */
  quotes: string[];
  /** 各主题被切换的次数 */
  themeCounts: Record<string, number>;
  /** 累计阅读秒数 */
  time: number;
  /** 按天累计的阅读秒数 */
  dayTime: Record<string, number>;
  /** 写入时的 schema 版本 */
  v?: number;
  lastTheme?: string;
  lastChapterTitle?: string;
  lastChapterFile?: string;
};

/** 备份文件的结构 */
type ReaderBackup = {
  app: string;
  schema: number;
  exportedAt: string;
  summary: { chapters: number; quotes: number; seconds: number };
  data: Record<string, string>;
};

interface Window {
  /** 三个模块共享的命名空间：LY.store / LY.engine / LY.ui */
  LY: any;
  /** 原生壳注入的桥（WebView） */
  LinyuanApp?: any;
  /** 站内对外函数（内联 onclick 用），这里不逐个声明 */
  [key: string]: any;
}
