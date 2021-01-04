(function (global) {
  "use strict";

  var util = newUtil();
  var inliner = newInliner();
  var fontFaces = newFontFaces();
  var images = newImages();

  // Default impl options
  var defaultOptions = {
    // Default is to fail on error, no placeholder
    imagePlaceholder: undefined,
    // Default cache bust is false, it will use the cache
    cacheBust: false,
  };

  /**
   * toPng、toPng、toJpeg、toBlob
   * 这几个方法都是通过用toSvg方法将节点转换为canvas之后，再对canvas进行相应的处理
   */
  var domtoimage = {
    toSvg: toSvg,
    toPng: toPng,
    toJpeg: toJpeg,
    toBlob: toBlob,
    toPixelData: toPixelData,
    impl: {
      fontFaces: fontFaces,
      images: images,
      util: util,
      inliner: inliner,
      options: {},
    },
  };

  if (typeof module !== "undefined") module.exports = domtoimage;
  else global.domtoimage = domtoimage;

  /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options
     * @param {Function} options.filter - Should return true if passed node should be included in the output
     *          (excluding node means excluding it's children as well). Not called on the root node.
     * @param {String} options.bgcolor - color for the background, any valid CSS color value.
     * @param {Number} options.width - width to be applied to node before rendering.
     * @param {Number} options.height - height to be applied to node before rendering.
     * @param {Object} options.style - an object whose properties to be copied to node's style before rendering.
     * @param {Number} options.quality - a Number between 0 and 1 indicating image quality (applicable to JPEG only),
                 defaults to 1.0.
    * @param {String} options.imagePlaceholder - dataURL to use as a placeholder for failed images, default behaviour is to fail fast on images we can't fetch
    * @param {Boolean} options.cacheBust - set to true to cache bust by appending the time to the request url
    * @return {Promise} - A promise that is fulfilled with a SVG image data URL
    * */
  function toSvg(node, options) {
    options = options || {};
    copyOptions(options);
    return Promise.resolve(node)
      .then(function (node) {
        return cloneNode(node, options.filter, true);
      })
      .then(embedFonts)
      .then(inlineImages)
      .then(applyOptions)
      .then(function (clone) {
        console.log(clone);
        return makeSvgDataUri(
          clone,
          options.width || util.width(node),
          options.height || util.height(node)
        );
      });

    function applyOptions(clone) {
      if (options.bgcolor) clone.style.backgroundColor = options.bgcolor;

      if (options.width) clone.style.width = options.width + "px";
      if (options.height) clone.style.height = options.height + "px";

      if (options.style)
        Object.keys(options.style).forEach(function (property) {
          clone.style[property] = options.style[property];
        });

      return clone;
    }
  }

  /**
   * @param {Node} node - The DOM Node object to render
   * @param {Object} options - Rendering options, @see {@link toSvg}
   * @return {Promise} - A promise that is fulfilled with a Uint8Array containing RGBA pixel data.
   * */
  function toPixelData(node, options) {
    return draw(node, options || {}).then(function (canvas) {
      return canvas
        .getContext("2d")
        .getImageData(0, 0, util.width(node), util.height(node)).data;
    });
  }

  /**
   * @param {Node} node - The DOM Node object to render
   * @param {Object} options - Rendering options, @see {@link toSvg}
   * @return {Promise} - A promise that is fulfilled with a PNG image data URL
   * */
  function toPng(node, options) {
    return draw(node, options || {}).then(function (canvas) {
      return canvas.toDataURL();
    });
  }

  /**
   * @param {Node} node - The DOM Node object to render
   * @param {Object} options - Rendering options, @see {@link toSvg}
   * @return {Promise} - A promise that is fulfilled with a JPEG image data URL
   * */
  function toJpeg(node, options) {
    options = options || {};
    return draw(node, options).then(function (canvas) {
      return canvas.toDataURL("image/jpeg", options.quality || 1.0);
    });
  }

  /**
   * @param {Node} node - The DOM Node object to render
   * @param {Object} options - Rendering options, @see {@link toSvg}
   * @return {Promise} - A promise that is fulfilled with a PNG image blob
   * */
  function toBlob(node, options) {
    return draw(node, options || {}).then(util.canvasToBlob);
  }

  function copyOptions(options) {
    // Copy options to impl options for use in impl
    if (typeof options.imagePlaceholder === "undefined") {
      domtoimage.impl.options.imagePlaceholder =
        defaultOptions.imagePlaceholder;
    } else {
      domtoimage.impl.options.imagePlaceholder = options.imagePlaceholder;
    }

    if (typeof options.cacheBust === "undefined") {
      domtoimage.impl.options.cacheBust = defaultOptions.cacheBust;
    } else {
      domtoimage.impl.options.cacheBust = options.cacheBust;
    }
  }

  /**
   * 绘制传入的dom节点
   */
  function draw(domNode, options) {
    // 将dom节点转为svg
    return (
      toSvg(domNode, options)
        // 拿到的svg是image data URL,这里进一步通过svg创建图片
        .then(util.makeImage)
        .then(util.delay(100))
        .then(function (image) {
          // 通过图片创建canvas并返回
          var canvas = newCanvas(domNode);
          canvas.getContext("2d").drawImage(image, 0, 0);
          return canvas;
        })
    );

    function newCanvas(domNode) {
      var canvas = document.createElement("canvas");
      canvas.width = options.width || util.width(domNode);
      canvas.height = options.height || util.height(domNode);

      if (options.bgcolor) {
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = options.bgcolor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      return canvas;
    }
  }

  /**
   * 递归克隆dom节点
   */
  function cloneNode(node, filter, root) {
    if (!root && filter && !filter(node)) return Promise.resolve();

    return Promise.resolve(node)
      .then(makeNodeCopy)
      .then(function (clone) {
        return cloneChildren(node, clone, filter);
      })
      .then(function (clone) {
        return processClone(node, clone);
      });

    // 遇到canvas转为image对象
    function makeNodeCopy(node) {
      if (node instanceof HTMLCanvasElement)
        return util.makeImage(node.toDataURL());
      // 克隆第一层
      return node.cloneNode(false);
    }
    // 克隆子节点
    function cloneChildren(original, clone, filter) {
      var children = original.childNodes;
      if (children.length === 0) return Promise.resolve(clone);

      return cloneChildrenInOrder(clone, util.asArray(children), filter).then(
        function () {
          return clone;
        }
      );

      function cloneChildrenInOrder(parent, children, filter) {
        var done = Promise.resolve();
        children.forEach(function (child) {
          done = done
            .then(function () {
              return cloneNode(child, filter);
            })
            .then(function (childClone) {
              if (childClone) parent.appendChild(childClone);
            });
        });
        return done;
      }
    }

    function processClone(original, clone) {
      if (!(clone instanceof Element)) return clone;

      return Promise.resolve()
        .then(cloneStyle)
        .then(clonePseudoElements)
        .then(copyUserInput)
        .then(fixSvg)
        .then(function () {
          return clone;
        });
      // 克隆节点上面所有使用的样式。
      function cloneStyle() {
        // 顺便提提，为什么不用style，因为如果什么样式也没有设置的话，style是光秃秃的
        // 而getComputedStyle则能获取到应用在节点上面所有样式
        copyStyle(window.getComputedStyle(original), clone.style);

        function copyStyle(source, target) {
          if (source.cssText) target.cssText = source.cssText;
          else copyProperties(source, target);

          function copyProperties(source, target) {
            util.asArray(source).forEach(function (name) {
              target.setProperty(
                name,
                source.getPropertyValue(name),
                source.getPropertyPriority(name)
              );
            });
          }
        }
      }
      // 提出伪类样式，放到css
      function clonePseudoElements() {
        [":before", ":after"].forEach(function (element) {
          clonePseudoElement(element);
        });

        function clonePseudoElement(element) {
          var style = window.getComputedStyle(original, element);
          var content = style.getPropertyValue("content");

          if (content === "" || content === "none") return;

          var className = util.uid();
          clone.className = clone.className + " " + className;
          var styleElement = document.createElement("style");
          styleElement.appendChild(
            formatPseudoElementStyle(className, element, style)
          );
          clone.appendChild(styleElement);
          function formatPseudoElementStyle(className, element, style) {
            var selector = "." + className + ":" + element;
            var cssText = style.cssText
              ? formatCssText(style)
              : formatCssProperties(style);
            return document.createTextNode(selector + "{" + cssText + "}");

            function formatCssText(style) {
              var content = style.getPropertyValue("content");
              return style.cssText + " content: " + content + ";";
            }

            function formatCssProperties(style) {
              return util.asArray(style).map(formatProperty).join("; ") + ";";

              function formatProperty(name) {
                return (
                  name +
                  ": " +
                  style.getPropertyValue(name) +
                  (style.getPropertyPriority(name) ? " !important" : "")
                );
              }
            }
          }
        }
      }
      // 处理输入框内容
      function copyUserInput() {
        if (original instanceof HTMLTextAreaElement)
          clone.innerHTML = original.value;
        if (original instanceof HTMLInputElement)
          clone.setAttribute("value", original.value);
      }
      // 处理svg，创建命名空间
      function fixSvg() {
        if (!(clone instanceof SVGElement)) return;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

        if (!(clone instanceof SVGRectElement)) return;
        ["width", "height"].forEach(function (attribute) {
          var value = clone.getAttribute(attribute);
          if (!value) return;

          clone.style.setProperty(attribute, value);
        });
      }
    }
  }

  /**
   * 嵌入字体
   * 提取font-face
   * 用内部样式加载
   */
  function embedFonts(node) {
    return fontFaces.resolveAll().then(function (cssText) {
      var styleNode = document.createElement("style");
      node.appendChild(styleNode);
      styleNode.appendChild(document.createTextNode(cssText));
      return node;
    });
  }

  /**
   * 嵌入图片
   */
  function inlineImages(node) {
    return images.inlineAll(node).then(function () {
      return node;
    });
  }

  /**
   * 创建SVG
   */
  function makeSvgDataUri(node, width, height) {
    return (
      Promise.resolve(node)
        .then(function (node) {
          // 将dom转换为字符串
          node.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
          return new XMLSerializer().serializeToString(node);
        })
        .then(util.escapeXhtml)
        .then(function (xhtml) {
          return (
            '<foreignObject x="0" y="0" width="100%" height="100%">' +
            xhtml +
            "</foreignObject>"
          );
        })
        /**
         * 顺带提一提
         * 不指定xmlns命名空间是不会渲染的
         * xmlns="http://www.w3.org/2000/svg"
         */

        .then(function (foreignObject) {
          return (
            '<svg xmlns="http://www.w3.org/2000/svg" width="' +
            width +
            '" height="' +
            height +
            '">' +
            foreignObject +
            "</svg>"
          );
        })
        .then(function (svg) {
          return "data:image/svg+xml;charset=utf-8," + svg;
        })
    );
  }

  /**
   * 这里定义了一堆公共使用的方法
   */
  function newUtil() {
    return {
      escape: escape,
      parseExtension: parseExtension,
      mimeType: mimeType,
      dataAsUrl: dataAsUrl,
      isDataUrl: isDataUrl,
      canvasToBlob: canvasToBlob,
      resolveUrl: resolveUrl,
      getAndEncode: getAndEncode,
      uid: uid(),
      delay: delay,
      asArray: asArray,
      escapeXhtml: escapeXhtml,
      makeImage: makeImage,
      width: width,
      height: height,
    };

    function mimes() {
      /*
       * Only WOFF and EOT mime types for fonts are 'real'
       * see http://www.iana.org/assignments/media-types/media-types.xhtml
       */
      var WOFF = "application/font-woff";
      var JPEG = "image/jpeg";

      return {
        woff: WOFF,
        woff2: WOFF,
        ttf: "application/font-truetype",
        eot: "application/vnd.ms-fontobject",
        png: "image/png",
        jpg: JPEG,
        jpeg: JPEG,
        gif: "image/gif",
        tiff: "image/tiff",
        svg: "image/svg+xml",
      };
    }

    function parseExtension(url) {
      var match = /\.([^\.\/]*?)$/g.exec(url);
      if (match) return match[1];
      else return "";
    }

    function mimeType(url) {
      var extension = parseExtension(url).toLowerCase();
      return mimes()[extension] || "";
    }

    /**
     * Data URL 判断
     */
    function isDataUrl(url) {
      return url.search(/^(data:)/) !== -1;
    }

    /**
     * 将canvas转换为Blob
     * 这里的实现方式是：将canvas转换为dataUrl提取其中的数据
     * 顺便提提
     * atob() 方法用于解码使用 base-64 编码的字符串。
     */
    function toBlob(canvas) {
      return new Promise(function (resolve) {
        var binaryString = window.atob(canvas.toDataURL().split(",")[1]);
        var length = binaryString.length;
        var binaryArray = new Uint8Array(length);

        for (var i = 0; i < length; i++)
          binaryArray[i] = binaryString.charCodeAt(i);

        resolve(
          new Blob([binaryArray], {
            type: "image/png",
          })
        );
      });
    }

    function canvasToBlob(canvas) {
      if (canvas.toBlob)
        return new Promise(function (resolve) {
          canvas.toBlob(resolve);
        });

      return toBlob(canvas);
    }

    /**
     * 顺便提提：
     * base标签，作用就是当a标签没有设置href值时候，就是使用base标签的href值。
     * 一份document里面只能有一个base标签
     */
    function resolveUrl(url, baseUrl) {
      var doc = document.implementation.createHTMLDocument();
      var base = doc.createElement("base");
      doc.head.appendChild(base);
      var a = doc.createElement("a");
      doc.body.appendChild(a);
      base.href = baseUrl;
      a.href = url;
      return a.href;
    }
    /**
     * 创建随机uid
     */
    function uid() {
      var index = 0;

      return function () {
        return "u" + fourRandomChars() + index++;

        function fourRandomChars() {
          /* see http://stackoverflow.com/a/6248722/2519373 */
          return (
            "0000" + ((Math.random() * Math.pow(36, 4)) << 0).toString(36)
          ).slice(-4);
        }
      };
    }

    // 创建image对象
    function makeImage(uri) {
      return new Promise(function (resolve, reject) {
        var image = new Image();
        image.crossOrigin = "Anonymous";
        image.onload = function () {
          resolve(image);
        };
        image.onerror = reject;
        image.src = uri;
      });
    }

    function getAndEncode(url) {
      var TIMEOUT = 30000;
      if (domtoimage.impl.options.cacheBust) {
        // Cache bypass so we dont have CORS issues with cached images
        // Source: https://developer.mozilla.org/en/docs/Web/API/XMLHttpRequest/Using_XMLHttpRequest#Bypassing_the_cache
        url += (/\?/.test(url) ? "&" : "?") + new Date().getTime();
      }

      return new Promise(function (resolve) {
        var request = new XMLHttpRequest();

        request.onreadystatechange = done;
        request.ontimeout = timeout;
        request.responseType = "blob";
        request.timeout = TIMEOUT;
        request.open("GET", url, true);
        request.send();

        var placeholder;
        if (domtoimage.impl.options.imagePlaceholder) {
          var split = domtoimage.impl.options.imagePlaceholder.split(/,/);
          if (split && split[1]) {
            placeholder = split[1];
          }
        }

        function done() {
          if (request.readyState !== 4) return;

          if (request.status !== 200) {
            if (placeholder) {
              resolve(placeholder);
            } else {
              fail(
                "cannot fetch resource: " + url + ", status: " + request.status
              );
            }

            return;
          }

          var encoder = new FileReader();
          encoder.onloadend = function () {
            var content = encoder.result.split(/,/)[1];
            resolve(content);
          };
          encoder.readAsDataURL(request.response);
        }

        function timeout() {
          if (placeholder) {
            resolve(placeholder);
          } else {
            fail(
              "timeout of " +
                TIMEOUT +
                "ms occured while fetching resource: " +
                url
            );
          }
        }

        function fail(message) {
          console.error(message);
          resolve("");
        }
      });
    }
    /**
     * 组装并且返回dataUrl
     */
    function dataAsUrl(content, type) {
      return "data:" + type + ";base64," + content;
    }

    function escape(string) {
      return string.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
    }
    /**
     * 延时
     */
    function delay(ms) {
      return function (arg) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(arg);
          }, ms);
        });
      };
    }
    /**
     * 类数组转为数组
     */
    function asArray(arrayLike) {
      var array = [];
      var length = arrayLike.length;
      for (var i = 0; i < length; i++) array.push(arrayLike[i]);
      return array;
    }

    function escapeXhtml(string) {
      return string.replace(/#/g, "%23").replace(/\n/g, "%0A");
    }
    /**
     * 获取元素总宽度 含border
     */
    function width(node) {
      var leftBorder = px(node, "border-left-width");
      var rightBorder = px(node, "border-right-width");
      return node.scrollWidth + leftBorder + rightBorder;
    }
    /**
     * 获取元素总高度 含border
     */
    function height(node) {
      var topBorder = px(node, "border-top-width");
      var bottomBorder = px(node, "border-bottom-width");
      return node.scrollHeight + topBorder + bottomBorder;
    }
    /**
     * 获取对象的指定的css属性的值，返回 number
     * 顺便提提：
     * window.getComputedStyle 最终能在元素上使用的所有css属性对象
     * window.getPropertyValue 可以获取CSS样式申明对象上的属性值
     * 为什么不直接用element.style 去获取？因为element.style只能获取元素style属性中的CSS样式，对于一个没有设置css属性的element来说，获取不到值的。
     */
    function px(node, styleProperty) {
      var value = window.getComputedStyle(node).getPropertyValue(styleProperty);
      return parseFloat(value.replace("px", ""));
    }
  }

  function newInliner() {
    var URL_REGEX = /url\(['"]?([^'"]+?)['"]?\)/g;

    return {
      inlineAll: inlineAll,
      shouldProcess: shouldProcess,
      impl: {
        readUrls: readUrls,
        inline: inline,
      },
    };

    /**
     * 判断是否包含url地址
     * 顺便提提：
     * search 方法可以接受正则 而 indexOf 只能接受字符串
     */
    function shouldProcess(string) {
      return string.search(URL_REGEX) !== -1;
    }

    /**
     * 提取样式里面的图片url地址（除了data url）
     */
    function readUrls(string) {
      var result = [];
      var match;
      while ((match = URL_REGEX.exec(string)) !== null) {
        result.push(match[1]);
      }
      return result.filter(function (url) {
        return !util.isDataUrl(url);
      });
    }

    function inline(string, url, baseUrl, get) {
      return Promise.resolve(url)
        .then(function (url) {
          return baseUrl ? util.resolveUrl(url, baseUrl) : url;
        })
        .then(get || util.getAndEncode)
        .then(function (data) {
          return util.dataAsUrl(data, util.mimeType(url));
        })
        .then(function (dataUrl) {
          return string.replace(urlAsRegex(url), "$1" + dataUrl + "$3");
        });

      function urlAsRegex(url) {
        return new RegExp(
          "(url\\(['\"]?)(" + util.escape(url) + ")(['\"]?\\))",
          "g"
        );
      }
    }

    function inlineAll(string, baseUrl, get) {
      if (nothingToInline()) return Promise.resolve(string);

      return Promise.resolve(string)
        .then(readUrls)
        .then(function (urls) {
          var done = Promise.resolve(string);
          urls.forEach(function (url) {
            done = done.then(function (string) {
              return inline(string, url, baseUrl, get);
            });
          });
          return done;
        });

      /**
       * 不包含url
       */
      function nothingToInline() {
        return !shouldProcess(string);
      }
    }
  }

  function newFontFaces() {
    return {
      resolveAll: resolveAll,
      impl: {
        readAll: readAll,
      },
    };

    function resolveAll() {
      return readAll(document)
        .then(function (webFonts) {
          return Promise.all(
            webFonts.map(function (webFont) {
              return webFont.resolve();
            })
          );
        })
        .then(function (cssStrings) {
          return cssStrings.join("\n");
        });
    }

    function readAll() {
      // 获取所有样式表，并处理为数组形式
      return Promise.resolve(util.asArray(document.styleSheets))
        .then(getCssRules)
        .then(selectWebFontRules)
        .then(function (rules) {
          return rules.map(newWebFont);
        });

      /**
       * 找出所有font-face样式
       */
      function selectWebFontRules(cssRules) {
        return cssRules
          .filter(function (rule) {
            return rule.type === CSSRule.FONT_FACE_RULE;
          })
          .filter(function (rule) {
            return inliner.shouldProcess(rule.style.getPropertyValue("src"));
          });
      }
      /**
       * 处理样式表
       * 或有包含所有 cssrules 的数组
       */
      function getCssRules(styleSheets) {
        var cssRules = [];
        styleSheets.forEach(function (sheet) {
          try {
            util
              .asArray(sheet.cssRules || [])
              .forEach(cssRules.push.bind(cssRules));
          } catch (e) {
            console.log(
              "Error while reading CSS rules from " + sheet.href,
              e.toString()
            );
          }
        });
        return cssRules;
      }

      function newWebFont(webFontRule) {
        return {
          resolve: function resolve() {
            var baseUrl = (webFontRule.parentStyleSheet || {}).href;
            return inliner.inlineAll(webFontRule.cssText, baseUrl);
          },
          src: function () {
            return webFontRule.style.getPropertyValue("src");
          },
        };
      }
    }
  }

  function newImages() {
    return {
      inlineAll: inlineAll,
      impl: {
        newImage: newImage,
      },
    };

    function newImage(element) {
      return {
        inline: inline,
      };

      /**
       * 将图片链接转换为dataUrl形式使用
       */
      function inline(get) {
        if (util.isDataUrl(element.src)) return Promise.resolve();

        return Promise.resolve(element.src)
          .then(get || util.getAndEncode)
          .then(function (data) {
            return util.dataAsUrl(data, util.mimeType(element.src));
          })
          .then(function (dataUrl) {
            return new Promise(function (resolve, reject) {
              element.onload = resolve;
              element.onerror = reject;
              element.src = dataUrl;
            });
          });
      }
    }

    function inlineAll(node) {
      if (!(node instanceof Element)) return Promise.resolve(node);

      return inlineBackground(node).then(function () {
        if (node instanceof HTMLImageElement) return newImage(node).inline();
        else
          return Promise.all(
            util.asArray(node.childNodes).map(function (child) {
              return inlineAll(child);
            })
          );
      });

      function inlineBackground(node) {
        var background = node.style.getPropertyValue("background");

        if (!background) return Promise.resolve(node);

        return inliner
          .inlineAll(background)
          .then(function (inlined) {
            node.style.setProperty(
              "background",
              inlined,
              node.style.getPropertyPriority("background")
            );
          })
          .then(function () {
            return node;
          });
      }
    }
  }
})(this);
