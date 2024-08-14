# uTools 帮助文档生成

文档来源 https://developer.mozilla.org/zh-CN/docs/Web/

## 项目初始化

```
npm i
```

## 文档生成

### JavaScript 文档生成

```
 npm run javascript
```

### Html 文档生成

```
 npm run html
```

### Web API/DOM 文档生成

```
 npm run api
```

### CSS 文档生成

```
 npm run css
```

### HTTP 文档生成

```
 npm run http
```

### 全部生成

```
 npm run all
```

## 更新记录

### 1.0.5

-   新增多种提示框样式
-   修复文档目录获取不全的问题
-   修复 `Web API` 文档的获取
-   修复某些文档没有兼容性信息引发的错误
-   修复英文文档未查询浏览器兼容性的情况
-   优化重复判断逻辑,避免同一个文章保存了中英两个版本
-   优化目录和内容共用缓存,请求失败也缓存失败结果,减少重复请求
-   文档标题使用页面标题,避免列表显示`toJSON()`实则是`LayoutShift: toJSON() method`这种大量列表重复的情况

### 1.0.4

-   优化表格样式内容超出显示不全的问题

### 1.0.3

-   增加对文档对`浏览器兼容性`的支持(简单实现)

### 1.0.2

-   修复 HTML 文档的获取

### 1.0.1

-   JavaScript 增加二级目录获取
-   获取文档时显示进度
-   修复过时函数未匹配到的情况
