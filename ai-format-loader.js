/* Load pinned libraries from two independent CDN providers. */
(function(){
  var bases=['https://cdn.jsdelivr.net/npm/','https://unpkg.com/'];
  function load(path,check,css){
    return new Promise(function(resolve){
      var i=0;
      function next(){
        if(!css&&check()){resolve(true);return;}
        if(i>=bases.length){resolve(false);return;}
        var el=document.createElement(css?'link':'script'),done=false;
        function finish(ok){if(done)return;done=true;clearTimeout(timer);if(ok&&(css||check()))resolve(true);else{el.remove();next();}}
        if(css){el.rel='stylesheet';el.href=bases[i++]+path;}else{el.src=bases[i++]+path;el.async=true;}
        el.onload=function(){finish(true);};el.onerror=function(){finish(false);};
        var timer=setTimeout(function(){finish(false);},12000);
        document.head.appendChild(el);
      }next();
    });
  }
  Promise.all([
    load('marked@15.0.12/marked.min.js',function(){return window.marked&&window.marked.parse;}),
    load('dompurify@3.2.6/dist/purify.min.js',function(){return window.DOMPurify&&window.DOMPurify.sanitize;}),
    load('katex@0.16.22/dist/katex.min.js',function(){return window.katex&&window.katex.render;}),
    load('katex@0.16.22/dist/katex.min.css',null,true)
  ]).then(function(results){if(results.every(Boolean))window.dispatchEvent(new Event('ai-format-ready'));else console.warn('AI formatting: library or stylesheet unavailable',results);});
})();
