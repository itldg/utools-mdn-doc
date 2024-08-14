const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const hljs = require('highlight.js/lib/highlight.js')
const support = require('./lib/support.js')
const { url } = require('inspector')
hljs.registerLanguage('javascript', require('highlight.js/lib/languages/javascript'))
hljs.registerLanguage('xml', require('highlight.js/lib/languages/xml'))
hljs.registerLanguage('css', require('highlight.js/lib/languages/css'))
const URL_BASE = 'https://developer.mozilla.org/zh-CN/docs/Web/'
let urlWhite = 'docs/Web/'

function removeHtmlTag(content) {
	content = content.replace(/(?:<\/?[a-z][a-z1-6]{0,9}>|<[a-z][a-z1-6]{0,9} .+?>)/gi, '')
	return content
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ')
}

/**
 * @typedef UrlItem 网址项
 * @property {String} key 网址标题
 * @property {String} src 网址
 * @property { "en-US" | "zh-CN" } language 语言()
 */

/**数组增加网址,去重
 * @param {UrlItem[]} list 原数组
 * @param {UrlItem[]} urls 新增的网址数组或单一对象
 * @return {*} 无返回值
 */
function pushUrl(list, urls) {
	if (!Array.isArray(urls)) {
		urls = [urls]
	}
	urls.forEach((x) => {
		if (!x.language) {
			x.language = x.src.includes('/zh-CN/') ? 'zh-CN' : 'en-US'
			//替换掉网址中的语言部分
			x.src = x.src.replace('/zh-CN/', '/').replace('/en-US/', '/')
		}
		if (x.src.includes(urlWhite)) {
			const index = list.findIndex((y) => y.src === x.src)
			if (index === -1) {
				list.push(x)
			} else if (x.language === 'zh-CN') {
				list[index].language = x.language
			}
		}
	})
}

/**检查是否是目录页面
 * @param {string} url 网址
 * @return {boolean} 是否是目录页面
 */
function checkUrlIsCatalogue(url) {
	const reg = /\/docs\/Web\/.*?\/.*?\/.+/
	return !reg.test(url)
}

function getLanguageRefrence(language) {
	return new Promise((resolve, reject) => {
		const docUrlBase = URL_BASE + language
		https
			.get(docUrlBase, (res) => {
				if (res.statusCode !== 200) {
					return reject(new Error('😱  入口返回状态码 --- ', res.statusCode))
				}
				res.setEncoding('utf8')
				let rawData = ''
				res.on('data', (chunk) => {
					rawData += chunk
				})
				res.on('end', async () => {
					const matchs = rawData.match(/<ol>([\s\S]*?)<\/ol>\n<\/div>/g)
					const regexList = /<li>[\s\S]*?<a[^>]*?href="([^"]*?)">([^>\n]*?)<\/a><\/li>/g

					/**网址目录
					 * @type {Array.<UrlItem>}
					 */
					const refrences = []
					try {
						if (matchs) {
							matchs.forEach((x, i) => {
								let m
								//<code>&lt;a&gt;</code>
								x = x.replace(/<code>(.*?)<\/code>/g, '$1')
								while ((m = regexList.exec(x)) !== null) {
									if (m.index === regexList.lastIndex) {
										regexList.lastIndex++
									}
									const src = m[1].trim()
									const key = removeHtmlTag(m[2].trim())
									pushUrl(refrences, { key, src })
								}
							})
						} else {
							//Web API文档没有左侧大目录
							//获取 article 标签内的所有链接
							const articleMatch = rawData.match(/<article[^>]*>([\s\S]*?)<\/article>/)
							if (!articleMatch) {
								return reject(new Error('😱  获取页面入口失败'))
							}
							const articleContent = articleMatch[1]
							const regexList = /<a [^>]*?href="([^#]*?)"[^>]*?>(<code>)?(.*?)(<\/code>)?<\/a>/g

							while ((m = regexList.exec(articleContent)) !== null) {
								if (m.index === regexList.lastIndex) {
									regexList.lastIndex++
								}
								const src = m[1].trim()
								const key = removeHtmlTag(m[3].trim())
								pushUrl(refrences, { key, src })
							}
						}
					} catch (e) {
						return reject(new Error('😱  获取页面入口失败:' + e.message))
					}
					// refrencesResult.push(...refrences)

					//额外获取一下 二级目录
					console.log('🍺一级目录获取完毕,开始获取二级目录')
					const lenStrLen = String(refrences.length).length
					for (let index = 0; index < refrences.length; index++) {
						console.log(`[${String(index + 1).padStart(lenStrLen, '0')}/${refrences.length}] ${refrences[index].src}`)
						// if (!checkUrlIsCatalogue(refrences[index].src)) {
						// 	continue
						// }
						const urls = await getCatalogue(refrences[index], language)
						pushUrl(refrences, urls)
					}

					if (!fs.existsSync(path.join(__dirname, 'data'))) {
						fs.mkdirSync(path.join(__dirname, 'data'))
					}
					//将入口页面也增加下采集
					refrences.unshift({
						key: language,
						src: '/docs/Web/' + language,
						language: 'zh-CN',
					})
					fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrences, null, 2))
					resolve()
				})
			})
			.on('error', (e) => {
				reject(e)
			})
	})
}
/**获取二级目录
 * @param {UrlItem} urlItem
 * @param {string} language 编程语言
 * @return {Promise<UrlItem[]>} 二级目录网址信息
 */
function getCatalogue(urlItem, language) {
	return new Promise(async (resolve, reject) => {
		let res
		try {
			res = await getPage(urlItem, language)
		} catch (e) {
			if (e.message.startsWith('notfound:')) {
				// urlItem = e.message.replace('notfound:', '').replace('zh-CN/', 'en-US/')
				if (urlItem.language == 'en-US') {
					return resolve([])
				}
				urlItem.language = 'en-US'
				console.log('retry en-US------' + urlItem.src)
				try {
					res = await getPage(urlItem, language)
				} catch (e) {
					//链接地址不存在
					return resolve([])
				}
			} else {
				console.error(e)
			}
		}
		//<div class="sidebar-body">
		const match = res.match(/<div class="sidebar-body">([\s\S]*?)<\/div>/)
		if (!match) {
			//没有二级目录
			return resolve([])
		}
		const content = match[1]
		const regexList = /<li>[\s\S]*?<a[^>]*?href="([^"]*?)">(<code>)?([^>\n]*?)(<\/code>)?<\/a>/g
		let refrences = []
		try {
			while ((m = regexList.exec(content)) !== null) {
				if (m.index === regexList.lastIndex) {
					regexList.lastIndex++
				}
				//不再考虑二级目录是否包含一级目录网址,可能存在其它二级目录入口链接
				const src = m[1].replace('https://developer.mozilla.org', '')
				if (!src.startsWith('/') && !src.includes('developer.mozilla.org')) {
					continue
				}
				const key = removeHtmlTag(m[3].trim())
				refrences.push({ key, src })
			}
		} catch (e) {
			return reject(new Error('😱  获取二级目录出错:' + e.message))
		}
		resolve(refrences)
	})
}

/**
 * 转换HTML内容
 * @param {Array} lowerSrcArray 已转为小写的所有网址列表
 * @param {String} htmlContent 当前页面的HTML源代码
 * @return {String} 处理后的文档页面
 */
function convertHtmlContent(lowerSrcArray, htmlContent) {
	const match = htmlContent.match(/<article[^>]*>([\s\S]*?)<\/article>/)
	if (match) {
		htmlContent = match[1]
	}

	const lastModified = htmlContent.match(/last modified on<!-- --> <time dateTime="([^"]*?)T/)
	htmlContent = htmlContent.replace(/<aside class="metadata">.*?<\/aside>/, '')
	htmlContent = htmlContent.replace(/<ul class="prev-next">.*?<\/ul>/g, '')
	if (lastModified) {
		htmlContent += `<hr/><p class="last-modified-date"><b>最后更新于:</b> <time >${lastModified[1]}</time></p>`
	}
	if (htmlContent.includes('class="prevnext"')) {
		htmlContent = htmlContent.replace(/<div class="prevnext"[\s\S]+?<\/div>/g, '')
	}
	if (htmlContent.includes('class="prev-next"')) {
		htmlContent = htmlContent.replace(/<ul class="prev-next"[\s\S]+?<\/ul>/g, '')
	}

	htmlContent = htmlContent.replace(/<section class="Quick_links" id="Quick_Links">[\s\S]+?<\/section>/, '')

	if (htmlContent.includes('<iframe ')) {
		htmlContent = htmlContent.replace(/<iframe.+src="([^"\n]+?)"[^>\n]*?>.*?<\/iframe>/g, '<a class="interactive-examples-link" href="$1">查看示例</a>')
	}
	const links = htmlContent.match(/<a[^>\n]+?href="[^"\n]+?"/g)
	if (links) {
		// 链接集合
		const linkSet = new Set(links)
		for (let link of linkSet) {
			let url = link.match(/<a[^>\n]+?href="([^"\n]+?)"/)[1].trim()
			if ((url.startsWith('https://developer.mozilla.org') || url.startsWith('/')) && url.includes(urlWhite)) {
				//替换文档链接
				let shortUrl = url.replace('https://developer.mozilla.org', '').toLowerCase().replace('/en-us/', '/').replace('/zh-cn/', '/')
				let anchor = ''
				if (shortUrl.includes('#')) {
					anchor = shortUrl.substring(shortUrl.indexOf('#'))
					shortUrl = shortUrl.substring(0, shortUrl.indexOf('#'))
				}

				if (lowerSrcArray.includes(shortUrl)) {
					const localFile = crypto.createHash('md5').update(shortUrl).digest('hex')
					let replaceText = 'href="' + url + '"'
					htmlContent = htmlContent.replace(new RegExp(replaceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'href="' + localFile + '.html' + anchor + '"')
					continue
				} else {
					// console.log('not found:', shortUrl)
				}
			}
			//外部链接无需处理
			if (/^https?:\/\//i.test(url)) continue
			const replaceRegex = new RegExp(('href="' + url + '"').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
			if (url.startsWith('/')) {
				htmlContent = htmlContent.replace(replaceRegex, 'href="https://developer.mozilla.org' + url + '"')
			}
		}
	}
	htmlContent = htmlContent.replace(/(<img[^>\n]+?src=")(\/[^"\n]+?")/g, '$1https://developer.mozilla.org$2')
	// JS 代码美化
	const jsCodes = htmlContent.match(/<pre.*?class="brush: ?js[^"\n]*?">[\s\S]+?<\/pre>/g)
	if (jsCodes) {
		jsCodes.forEach((preRaw) => {
			const highlightedCode = hljs.highlight('javascript', removeHtmlTag(preRaw)).value
			htmlContent = htmlContent.replace(preRaw, '<pre><code class="javascript hljs">' + highlightedCode + '</code></pre>')
		})
	}
	// HTML 代码美化
	const htmlCodes = htmlContent.match(/<pre.*?class="brush: ?html[^"\n]*?">[\s\S]+?<\/pre>/g)
	if (htmlCodes) {
		htmlCodes.forEach((preRaw) => {
			const highlightedCode = hljs.highlight('xml', removeHtmlTag(preRaw)).value
			htmlContent = htmlContent.replace(preRaw, '<pre><code class="xml hljs">' + highlightedCode + '</code></pre>')
		})
	}
	// CSS 代码美化
	const cssCodes = htmlContent.match(/<pre.*?class="brush: ?css[^"\n]*?">[\s\S]+?<\/pre>/g)
	if (cssCodes) {
		cssCodes.forEach((preRaw) => {
			const highlightedCode = hljs.highlight('css', removeHtmlTag(preRaw)).value
			htmlContent = htmlContent.replace(preRaw, '<pre><code class="css hljs">' + highlightedCode + '</code></pre>')
		})
	}
	return `<!DOCTYPE html><html lang="zh_CN"><head><meta charset="UTF-8"><title></title><link rel="stylesheet" href="doc.css" /></head>
  <body>${htmlContent}</body></html>`
	// const jsSyntaxCodes = rawData.match(/<pre.*?class="syntaxbox">[\s\S]+?<\/pre>/g)
	// if (jsSyntaxCodes) {
	//   jsSyntaxCodes.forEach(preRaw => {
	//     const highlightedCode = hljs.highlight('javascript', removeHtmlTag(preRaw)).value
	//     rawData = rawData.replace(preRaw, '<pre><code class="javascript hljs">' + highlightedCode + '</code></pre>')
	//   })
	// }
}

/**获取页面信息
 * @param {UrlItem} urlItem
 * @param {string} language 教程语言
 * @return {Promise} 页面内容
 */
function getPage(urlItem, language) {
	let url = `${urlItem.language}${urlItem.src}`
	const filename = crypto.createHash('md5').update(url.toLowerCase()).digest('hex')
	const cachePath = path.join(__dirname, 'data', language, filename)
	const cacheFaultPath = cachePath + '_fault'
	if (fs.existsSync(cacheFaultPath)) {
		return new Promise((resolve, reject) => {
			fs.readFile(cacheFaultPath, { encoding: 'utf-8' }, (err, data) => {
				if (err) {
					return reject(err)
				}
				reject(new Error(data))
			})
		})
	}

	if (fs.existsSync(cachePath)) {
		return new Promise((resolve, reject) => {
			fs.readFile(cachePath, { encoding: 'utf-8' }, (err, data) => {
				if (err) {
					return reject(err)
				}
				resolve(data)
			})
		})
	}

	return new Promise((resolve, reject) => {
		url = `https://developer.mozilla.org/` + url
		https.get(url, (res) => {
			if (res.statusCode !== 200) {
				let errorMsg = '🥵  获取页面 返回状态码 *** ' + res.statusCode + '\n' + url
				if (res.statusCode === 301 || res.statusCode === 302) {
					errorMsg = 'redirect:' + res.headers['location']
				} else if (res.statusCode === 404) {
					errorMsg = 'notfound:' + url
				}
				fs.writeFileSync(cacheFaultPath, errorMsg)
				return reject(new Error(errorMsg))
			}
			res.setEncoding('utf8')
			let rawData = ''
			res.on('data', (chunk) => {
				rawData += chunk
			})
			res.on('end', () => {
				// 保存一份缓存
				const cacheDir = path.join(__dirname, 'data', language)
				if (!fs.existsSync(cacheDir)) {
					fs.mkdirSync(cacheDir)
				}
				fs.writeFileSync(cachePath, rawData)
				resolve(rawData)
			})
		})
	})
}

/**
 * 获取文档页面
 * @param {Array} lowerSrcArray 已转为小写的所有网址列表
 * @param {UrlItem} urlItem 当前网址对象
 * @param {String} language 当前语言
 * @return {[String,String]} 处理后的文档路径,文档内容
 */
function getDocPage(lowerSrcArray, urlItem, language) {
	return getPage(urlItem, language).then(async (html) => {
		let content = convertHtmlContent(lowerSrcArray, html)
		content = await support.changeBrowserSupport(html, content)
		const filename = crypto.createHash('md5').update(urlItem.src.toLowerCase()).digest('hex')
		fs.writeFileSync(path.join(__dirname, 'public', language, 'docs', filename + '.html'), content)
		return ['docs/' + filename + '.html', html]
	})
}

/**获取文档摘要
 * @param {String} docHtml 文档Html内容
 * @return {String} 文档摘要,获取失败返回暂无描述
 */
function getDocSummary(docHtml) {
	const matchs = docHtml.match(/"summary":"(.*?)","/)
	return matchs ? matchs[1] : '暂无描述'
}

/**获取文档标题
 * @param {String} docHtml 文档Html内容
 * @param {String} defaultTitle 默认标题
 * @return {String} 成功返回识别的文档标题,否则返回默认标题
 */
function getDocTitle(docHtml, defaultTitle = '未知标题') {
	const matchs = docHtml.match(/<header><h1>(.*?)<\/h1><\/header>/)
	return matchs ? matchs[1] : defaultTitle
}

function copyFolder(source, target) {
	if (!fs.existsSync(target)) {
		fs.mkdirSync(target)
	}

	// 读取源文件夹中的所有文件/文件夹
	const files = fs.readdirSync(source)

	// 遍历所有文件/文件夹
	files.forEach((file) => {
		const sourcePath = path.join(source, file)
		const targetPath = path.join(target, file)

		// 判断当前文件是否为文件夹
		if (fs.statSync(sourcePath).isDirectory()) {
			// 如果是文件夹，递归拷贝子文件夹
			copyFolder(sourcePath, targetPath)
		} else {
			// 如果是文件，直接拷贝
			fs.copyFileSync(sourcePath, targetPath)
		}
	})
}
/**
 * 更新文档中的 更新时间 和 文档数量
 * @param {String} language 语言
 * @param {Array} indexes 文档目录
 */
function updateReadMe(language, indexes) {
	// 最后更新: 2023-10-14 // 文档数量: 197 篇
	const readmePath = path.join(__dirname, 'public', language, 'README.md')
	return new Promise((resolve, reject) => {
		fs.readFile(readmePath, { encoding: 'utf-8' }, async (err, data) => {
			if (err) {
				return reject(err)
			}
			const doc = data.toString()
			const reg = /最后更新: \d{4}-\d{2}-\d{2}/
			const reg2 = /文档数量: \d+ 篇/
			const date = new Date()
			const dateStr = date.getFullYear() + '-' + (date.getMonth() + 1).toString().padStart(2, '0') + '-' + date.getDate().toString().padStart(2, '0')
			let newDoc = doc.replace(reg, '最后更新: ' + dateStr).replace(reg2, '文档数量: ' + indexes.length + ' 篇')
			const regCatalogue = /(文档目录:\s+)[\s\S]+/
			let catalogue = indexes.map((item) => '- ' + item.t).join('\r\n')
			newDoc = newDoc.replace(regCatalogue, '$1') + catalogue
			fs.writeFileSync(readmePath, newDoc)
			resolve()
		})
	})
}

/**
 *@typedef ArticleInfo 文章信息
 *@property {String} t 文章标题
 *@property {String} p 文章路径
 *@property {String} d 文章描述
 */

/**获取文章信息
 * @param {string[]} lowerSrcArray 所有网址列表(已转化小写)
 * @param {string} language 语言
 * @param {UrlItem} urlItem 网址信息
 * @return {ArticleInfo} 文章信息
 */
async function getArticle(lowerSrcArray, language, urlItem) {
	const [docFile, docHtml] = await getDocPage(lowerSrcArray, urlItem, language)
	const summary = getDocSummary(docHtml)
	const docTitle = getDocTitle(docHtml, urlItem.key)
	return { t: docTitle, p: docFile, d: summary }
}
async function main() {
	const argv = process.argv.slice(2)
	const language = argv[0]
	urlWhite = 'docs/Web/' + language + '/'
	if (!fs.existsSync(path.join(__dirname, 'data', language + '-refrences.json'))) {
		try {
			await getLanguageRefrence(language)
		} catch (e) {
			console.log(e.message)
			return
		}
		console.log(`----------${language}索引获取完成---------`)
	}
	/**
	 * @type {UrlItem[]}
	 */
	const refrences = require('./data/' + language + '-refrences.json')
	const indexPath = path.join(__dirname, 'public', language, 'docs')
	if (!fs.existsSync(indexPath)) {
		fs.mkdirSync(indexPath)
	}
	//所有网址转小写,对比使用
	const lowerSrcArray = refrences.map((x) => x.src.toLowerCase())
	const indexesFilePath = path.join(__dirname, 'public', language, 'indexes.json')
	let indexes = []

	const lenStrLen = String(refrences.length).length
	for (let i = 0; i < refrences.length; i++) {
		const logStart = `[${String(i + 1).padStart(lenStrLen, '0')}/${refrences.length}]`
		const item = refrences[i]
		try {
			let articleInfo = await getArticle(lowerSrcArray, language, item)
			indexes.push(articleInfo)
		} catch (e) {
			// console.error(e)
			if (e.message.startsWith('redirect:')) {
				item.src = e.message.replace('redirect:', '').replace('?raw=&macros=', '')
			}
			if (e.message.startsWith('notfound:')) {
				// item.src = e.message.replace('notfound:', '').replace('zh-CN/', 'en-US/')
				item.language = 'en-US'
			}
			console.log(logStart, '⌛', e.message)
			try {
				articleInfo = await getArticle(lowerSrcArray, language, item)
				indexes.push(articleInfo)
			} catch (e) {
				console.log(logStart, '💢', e.message)
				continue
			}
		}
		console.log(logStart, '✅', item.src)
	}
	fs.writeFileSync(path.join(__dirname, 'data', language + '-refrences.json'), JSON.stringify(refrences, null, 2))
	fs.writeFileSync(indexesFilePath, JSON.stringify(indexes))
	fs.copyFileSync(path.join(__dirname, 'doc.css'), path.join(__dirname, 'public', language, 'docs', 'doc.css'))
	copyFolder(path.join(__dirname, 'images'), path.join(__dirname, 'public', language, 'docs', 'images'))
	await updateReadMe(language, indexes)
	console.log('--------  😁 全部完成,共计' + indexes.length + '篇文档 --------')
	process.exit(0)
}
// async function test() {
// 	const r = await getCatalogue('/en-US/docs/Web/API/CSS_Object_Model', 'API')
// 	console.log(r)
// }
// test()
main()
