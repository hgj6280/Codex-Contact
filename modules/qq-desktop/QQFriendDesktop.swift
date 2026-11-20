import AppKit
import WebKit
import AVFoundation

final class DesktopApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, AVSpeechSynthesizerDelegate {
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        HubCredential.respond(to: challenge, completion: completionHandler)
    }

    private var window: NSWindow!
    private var web: WKWebView!
    private var utilityWindows: [String:NSWindow] = [:]
    private var remoteInputs: [String:RemoteQQInput] = [:]
    private var petWindow: NSWindow?
    private var biliLoginWindow: BiliLoginWindow?
    private let speech = AVSpeechSynthesizer()
    private var recoveryRunning = false
    private var serviceNotice: String?
    private var offlineStatus: NSTextField?
    private let hub = URL(string:"http://127.0.0.1:3789/desktop.html")!
    private var project: String { Bundle.main.object(forInfoDictionaryKey:"QQFriendProjectRoot") as? String ?? "" }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        speech.delegate=self
        buildMenu()
        let config=WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self,name:"qqDesktop")
        web=WKWebView(frame:.zero,configuration:config)
        web.navigationDelegate=self;web.uiDelegate=self
        web.allowsBackForwardNavigationGestures=false
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1150,height:790),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title="狐宫静 QQ";window.minSize=NSSize(width:800,height:590)
        window.isReleasedWhenClosed=false;window.setFrameAutosaveName("QQFriendMain")
        window.contentView=web;window.center();window.makeKeyAndOrderFront(nil)
        NotificationCenter.default.addObserver(self,selector:#selector(activeChanged),name:NSApplication.didBecomeActiveNotification,object:nil)
        NotificationCenter.default.addObserver(self,selector:#selector(activeChanged),name:NSApplication.didResignActiveNotification,object:nil)
        web.load(URLRequest(url:hub))
        NSApp.activate(ignoringOtherApps:true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {false}
    func applicationWillTerminate(_ notification:Notification){stopLocalVoice()}
    private func stopLocalVoice(){
        speech.stopSpeaking(at:.immediate)
        var request=URLRequest(url:URL(string:"http://127.0.0.1:3789/api/life/voice/cancel")!);request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=Data("{}".utf8)
        if let key = HubCredential.key() {
            request.setValue(key, forHTTPHeaderField:"x-qq-desktop-key")
            URLSession.shared.dataTask(with:request).resume()
        }
    }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {
        if !flag {window.makeKeyAndOrderFront(nil)};NSApp.activate(ignoringOtherApps:true);return true
    }
    @objc private func activeChanged(){emit("nativeActive",["active":NSApp.isActive])}
    func speechSynthesizer(_ synthesizer:AVSpeechSynthesizer,didStart utterance:AVSpeechUtterance){speechState(true)}
    func speechSynthesizer(_ synthesizer:AVSpeechSynthesizer,didFinish utterance:AVSpeechUtterance){speechState(false)}
    func speechSynthesizer(_ synthesizer:AVSpeechSynthesizer,didCancel utterance:AVSpeechUtterance){speechState(false)}
    private func speechState(_ speaking:Bool){DispatchQueue.main.async{[weak self] in self?.emit("nativeSpeech",["speaking":speaking])}}
    private func emit(_ name:String,_ detail:[String:Any]){
        guard let data=try? JSONSerialization.data(withJSONObject:detail),let json=String(data:data,encoding:.utf8) else{return}
        var views=[web!];views.append(contentsOf:utilityWindows.values.compactMap{$0.contentView as? WKWebView})
        if let view=petWindow?.contentView as? WKWebView {views.append(view)}
        for view in views {view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)',{detail:\(json)}))",completionHandler:nil)}
    }
    private func ownMain(_ url:URL?)->Bool {
        guard let u=url else{return false}
        return u.scheme=="http"&&u.host=="127.0.0.1"&&u.port==3789
    }
    private func local(_ url:URL)->Bool {url.scheme=="http"&&url.host=="127.0.0.1"&&[3789,6099,6081,5099].contains(url.port ?? 0)}
    private var qqLoginURL:URL {
        let path=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CodexRemoteContact/napcat-state/backend.json")
        let data=try? Data(contentsOf:path)
        let value=data.flatMap{try? JSONSerialization.jsonObject(with:$0) as? [String:Any]}
        return URL(string:value?["kind"] as? String == "snowluma" ? "http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=scale":"http://127.0.0.1:6099/webui/web_login")!
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){
        let offline=message.frameInfo.request.url==Bundle.main.url(forResource:"offline",withExtension:"html")
        guard message.frameInfo.isMainFrame,(ownMain(message.frameInfo.request.url)||offline),let body=message.body as? [String:Any],let action=body["action"] as? String else{return}
        switch action {
        case "theme":NSApp.appearance=NSAppearance(named:(body["dark"] as? Bool)==true ? .darkAqua:.aqua)
        case "openLogin":openLocal(qqLoginURL,title:"QQ 扫码登录")
        case "openManager":openLocal(URL(string:"http://127.0.0.1:3789/client.html")!,title:"群友管理")
        case "openLife":openLocal(URL(string:"http://127.0.0.1:3789/life.html")!,title:"狐宫静 · 生活与分身")
        case "openPet":openPet()
        case "closePet":closePet()
        case "petExpanded":
            let expanded=(body["expanded"] as? Bool)==true
            if let panel=petWindow {let old=panel.frame;panel.setContentSize(NSSize(width:expanded ? 360:190,height:expanded ? 620:230));var frame=panel.frame;frame.origin=NSPoint(x:old.maxX-frame.width,y:old.minY);panel.setFrame(frame,display:true)}
            if expanded {NSApp.activate(ignoringOtherApps:true);petWindow?.makeKeyAndOrderFront(nil)}
        case "speak":if let text=body["text"] as? String {speech.stopSpeaking(at:.immediate);let utterance=AVSpeechUtterance(string:String(text.prefix(2000)));utterance.voice=AVSpeechSynthesisVoice(language:"zh-CN");utterance.rate=0.48;utterance.volume=0.65;speech.speak(utterance)}
        case "stopSpeaking":speech.stopSpeaking(at:.immediate)
        case "openBiliLogin":
            if biliLoginWindow == nil {biliLoginWindow=BiliLoginWindow{[weak self] account in self?.emit("biliConnected",account)}}
            biliLoginWindow?.show()
        case "openArchive":
            let folder=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads/AI群友生图")
            if FileManager.default.fileExists(atPath:folder.path){NSWorkspace.shared.open(folder)}
        case "startServices":startServices()
        case "reload":web.load(URLRequest(url:hub))
        default:break
        }
    }
    private func openLocal(_ url:URL,title:String){
        if let old=utilityWindows[title]{old.makeKeyAndOrderFront(nil);return}
        let config=WKWebViewConfiguration();config.websiteDataStore = .default();config.userContentController.add(self,name:"qqDesktop")
        let view=WKWebView(frame:NSRect(x:0,y:0,width:920,height:750),configuration:config);view.navigationDelegate=self;view.uiDelegate=self
        let panel=NSWindow(contentRect:NSRect(x:0,y:0,width:920,height:750),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        panel.title=title;panel.isReleasedWhenClosed=false;panel.delegate=self
        if url.port==6081,let node=Bundle.main.object(forInfoDictionaryKey:"QQFriendNode") as? String,let helper=Bundle.main.url(forResource:"qq-remote-clipboard",withExtension:"mjs") {
            let input=RemoteQQInput(view:view,node:node,helper:helper)
            remoteInputs[title]=input;panel.contentView=input.root;input.root.layout()
        }else{panel.contentView=view}
        utilityWindows[title]=panel;view.load(URLRequest(url:url));panel.center();panel.makeKeyAndOrderFront(nil)
    }
    private func openPet(){
        if let panel=petWindow {NSApp.activate(ignoringOtherApps:true);panel.makeKeyAndOrderFront(nil);return}
        let config=WKWebViewConfiguration();config.websiteDataStore = .default();config.userContentController.add(self,name:"qqDesktop")
        config.mediaTypesRequiringUserActionForPlayback=[]
        let view=WKWebView(frame:.zero,configuration:config);view.setValue(false,forKey:"drawsBackground");view.navigationDelegate=self;view.uiDelegate=self
        let panel=NSWindow(contentRect:NSRect(x:0,y:0,width:190,height:230),styleMask:[.titled,.closable],backing:.buffered,defer:false)
        panel.title="狐宫静 · 拖动标题移动";panel.titleVisibility = .visible;panel.titlebarAppearsTransparent=false
        panel.isOpaque=true;panel.backgroundColor = .windowBackgroundColor;panel.hasShadow=true;panel.level = .floating
        panel.isMovableByWindowBackground=false;panel.hidesOnDeactivate=false
        panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary];panel.isReleasedWhenClosed=false
        if let screen=NSScreen.main {panel.setFrameOrigin(NSPoint(x:screen.visibleFrame.maxX-215,y:screen.visibleFrame.minY+25))}
        if let saved=UserDefaults.standard.string(forKey:"QQFriendPetAnchor") {let anchor=NSPointFromString(saved),origin=NSPoint(x:anchor.x-panel.frame.width,y:anchor.y);if NSScreen.screens.contains(where:{$0.visibleFrame.intersects(NSRect(origin:origin,size:panel.frame.size))}){panel.setFrameOrigin(origin)}}
        panel.contentView=view;petWindow=panel;panel.delegate=self;panel.makeKeyAndOrderFront(nil);view.load(URLRequest(url:URL(string:"http://127.0.0.1:3789/pet.html")!))
    }
    func windowDidMove(_ notification:Notification){if let panel=petWindow,notification.object as? NSWindow === panel {UserDefaults.standard.set(NSStringFromPoint(NSPoint(x:panel.frame.maxX,y:panel.frame.minY)),forKey:"QQFriendPetAnchor")}}
    func windowWillClose(_ notification:Notification){
        guard let closing=notification.object as? NSWindow else{return}
        if let entry=utilityWindows.first(where:{$0.value===closing}) {
            if let input=remoteInputs.removeValue(forKey:entry.key){input.close();input.view.stopLoading();input.view.configuration.userContentController.removeScriptMessageHandler(forName:"qqDesktop")}
            if entry.key=="狐宫静 · 生活与分身" {stopLocalVoice()}
            if let view=closing.contentView as? WKWebView {view.stopLoading();view.configuration.userContentController.removeScriptMessageHandler(forName:"qqDesktop")}
            closing.contentView=nil;utilityWindows.removeValue(forKey:entry.key);return
        }
        guard let panel=petWindow,closing===panel else{return}
        stopLocalVoice()
        if let view=panel.contentView as? WKWebView {view.stopLoading();view.configuration.userContentController.removeScriptMessageHandler(forName:"qqDesktop")}
        panel.contentView=nil;petWindow=nil
    }
    private func closePet(){
        petWindow?.close()
    }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=navigationAction.request.url else{decisionHandler(.cancel);return}
        let offline=url.isFileURL&&url.lastPathComponent=="offline.html"&&url.deletingLastPathComponent()==Bundle.main.resourceURL
        if local(url)||offline {decisionHandler(.allow);return}
        if navigationAction.navigationType == .linkActivated&&["http","https"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)}
        decisionHandler(.cancel)
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? {
        if let url=navigationAction.request.url {
            if local(url){openLocal(url,title:url.port==6099 ? "QQ 扫码登录":"群友管理")}
            else if ["http","https"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)}
        };return nil
    }
    private func showOffline(_ message:String){
        let view=NSView(),stack=NSStackView();stack.orientation = .vertical;stack.spacing=18
        let title=NSTextField(labelWithString:"🦊 后台暂未连接")
        title.font = .systemFont(ofSize:24,weight:.semibold)
        let status=NSTextField(wrappingLabelWithString:message)
        status.alignment = .center;status.textColor = .secondaryLabelColor
        offlineStatus=status
        let recover=NSButton(title:"启动 / 恢复后台",target:self,action:#selector(recoverOffline))
        recover.bezelStyle = .rounded
        let retry=NSButton(title:"重新连接",target:self,action:#selector(reload))
        retry.bezelStyle = .rounded
        let loginButton=NSButton(title:"QQ 扫码登录",target:self,action:#selector(login))
        loginButton.bezelStyle = .rounded
        [title,status,recover,retry,loginButton].forEach{stack.addArrangedSubview($0)}
        view.addSubview(stack);stack.translatesAutoresizingMaskIntoConstraints=false
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo:view.centerXAnchor),stack.centerYAnchor.constraint(equalTo:view.centerYAnchor),stack.widthAnchor.constraint(lessThanOrEqualToConstant:560),stack.leadingAnchor.constraint(greaterThanOrEqualTo:view.leadingAnchor,constant:28),stack.trailingAnchor.constraint(lessThanOrEqualTo:view.trailingAnchor,constant:-28)])
        window.contentView=view
    }
    @objc private func recoverOffline(){startServices()}
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){
        guard webView===web,(error as NSError).code != NSURLErrorCancelled else{return}
        showOffline("消息后台没有响应。点击「启动 / 恢复后台」检查服务，或「重新连接」重试。不会清除人设、聊天记录或 QQ 登录。\n\(error.localizedDescription)")
    }
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error){
        guard webView===web,(error as NSError).code != NSURLErrorCancelled else{return}
        showOffline("页面加载失败，可点击「重新连接」恢复。\n\(error.localizedDescription)")
    }
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView){
        if webView===web {showOffline("页面进程意外退出。点击「重新连接」即可重新载入，后台与 QQ 登录不受影响。")}
    }
    private func connectRemoteDesktop(_ view:WKWebView) {
        guard let url=view.url,url.scheme=="http",url.host=="127.0.0.1",url.port==6081,url.path=="/vnc.html" else{return}
        let file=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CodexRemoteContact/snowluma-qq/data/config/vnc-password")
        guard let value=try? String(contentsOf:file,encoding:.utf8) else{return}
        let password=value.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !password.isEmpty,password.count<=256 else{return}
        // Only this trusted loopback document receives a transient argument.
        // Never persist credentials in source, URL, localStorage or logs.
        view.callAsyncJavaScript("""
          if(location.origin!=='http://127.0.0.1:6081'||location.pathname!=='/vnc.html')return false;
          return await new Promise(resolve=>{
            let attempts=0;
            const timer=setInterval(()=>{
              if(++attempts>120){clearInterval(timer);resolve(false);return;}
              const dialog=document.getElementById('noVNC_credentials_dlg');
              const input=document.getElementById('noVNC_password_input');
              const button=document.getElementById('noVNC_credentials_button');
              if(dialog?.classList.contains('noVNC_open')&&input&&button){
                clearInterval(timer);input.value=password;
                input.dispatchEvent(new Event('input',{bubbles:true}));
                button.click();resolve(true);
              }
            },250);
          });
        """,arguments:["password":password],in:nil,in:.page,completionHandler:{_ in})
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        connectRemoteDesktop(webView)
        if webView===web,ownMain(webView.url) {window.contentView=web;offlineStatus=nil}
        if webView===web,ownMain(webView.url),let notice=serviceNotice {serviceNotice=nil;emit("nativeServiceResult",["message":notice])}
    }
    func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){
        guard ownMain(frame.request.url),frame.isMainFrame else{completionHandler(nil);return}
        let panel=NSOpenPanel();panel.allowsMultipleSelection=false;panel.canChooseDirectories=false
        panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.urls:nil)}
    }
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){
        let a=NSAlert();a.messageText="确认操作";a.informativeText=message;a.addButton(withTitle:"继续");a.addButton(withTitle:"取消")
        a.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn)}
    }
    private func startServices(){
        guard !recoveryRunning else{return};recoveryRunning=true
        offlineStatus?.stringValue="正在检查并恢复本机后台，请稍等…（不会重启已运行的任务）"
        guard let node=Bundle.main.object(forInfoDictionaryKey:"QQFriendNode") as? String,
              let script=Bundle.main.url(forResource:"qq-desktop-start",withExtension:"mjs")else {recoveryRunning=false;return}
        let root=project
        DispatchQueue.global(qos:.utility).async{[weak self] in
            let process=Process(),pipe=Pipe();process.executableURL=URL(fileURLWithPath:node);process.arguments=[script.path,root]
            process.standardOutput=pipe;process.standardError=pipe
            var result=""
            do {try process.run();let data=pipe.fileHandleForReading.readDataToEndOfFile();process.waitUntilExit();result=String(data:data,encoding:.utf8) ?? "服务检查结束"}
            catch {result="后台启动失败：\(error.localizedDescription)"}
            DispatchQueue.main.async{[weak self] in
                self?.recoveryRunning=false;self?.serviceNotice=result.trimmingCharacters(in:.whitespacesAndNewlines)
                self?.offlineStatus?.stringValue=result.trimmingCharacters(in:.whitespacesAndNewlines)
                self?.web.load(URLRequest(url:self?.hub ?? URL(string:"http://127.0.0.1:3789/desktop.html")!))
            }
        }
    }
    private func alert(_ title:String,_ detail:String){let a=NSAlert();a.messageText=title;a.informativeText=detail;a.runModal()}
    private func buildMenu(){
        let menu=NSMenu(),appItem=NSMenuItem(),appMenu=NSMenu()
        appMenu.addItem(withTitle:"关于狐宫静 QQ",action:#selector(about),keyEquivalent:"")
        appMenu.addItem(.separator());appMenu.addItem(withTitle:"退出狐宫静 QQ",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        appItem.submenu=appMenu;menu.addItem(appItem)
        let editItem=NSMenuItem(),edit=NSMenu(title:"编辑")
        for (title,selector,key) in [("撤销","undo:","z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] {edit.addItem(withTitle:title,action:NSSelectorFromString(selector),keyEquivalent:key)}
        editItem.submenu=edit;menu.addItem(editItem)
        let viewItem=NSMenuItem(),view=NSMenu(title:"窗口")
        view.addItem(withTitle:"刷新",action:#selector(reload),keyEquivalent:"r")
        view.addItem(withTitle:"QQ 扫码登录",action:#selector(login),keyEquivalent:"l")
        view.addItem(withTitle:"打开桌面分身",action:#selector(showPet),keyEquivalent:"p")
        view.addItem(withTitle:"关闭桌面分身",action:#selector(hidePet),keyEquivalent:"")
        view.addItem(withTitle:"生活与 B站",action:#selector(showLife),keyEquivalent:"")
        view.addItem(withTitle:"关闭窗口",action:#selector(NSWindow.performClose(_:)),keyEquivalent:"w")
        viewItem.submenu=view;menu.addItem(viewItem);NSApp.mainMenu=menu;NSApp.windowsMenu=view
    }
    @objc private func reload(){if let active=NSApp.keyWindow?.contentView as? WKWebView,ownMain(active.url){active.reload()}else{web.load(URLRequest(url:hub))}}
    @objc private func login(){openLocal(qqLoginURL,title:"QQ 扫码登录")}
    @objc private func showPet(){openPet()}
    @objc private func hidePet(){closePet()}
    @objc private func showLife(){openLocal(URL(string:"http://127.0.0.1:3789/life.html")!,title:"狐宫静 · 生活与分身")}
    @objc private func about(){alert("狐宫静 QQ · 1.0","轻量 macOS 聊天客户端，使用系统 WebKit，复用本机群友后台。\n\n不是腾讯官方 QQ，不包含浏览器、模型或小程序运行环境。退出窗口或 App 不会停止后台群友。")}
}
// Native IME composition stays on the Mac. Only committed text is sent over
// stdin to the fixed, local X11 clipboard helper; no global clipboard watcher.
final class RemoteQQRoot:NSView {
    weak var remote:WKWebView?
    weak var toolbar:NSView?
    override func layout(){
        super.layout()
        toolbar?.frame=NSRect(x:12,y:10,width:max(0,bounds.width-24),height:56)
        remote?.frame=NSRect(x:0,y:78,width:bounds.width,height:max(0,bounds.height-78))
    }
}
final class RemoteQQInput:NSObject {
    let root=RemoteQQRoot(frame:NSRect(x:0,y:0,width:920,height:750)),view:WKWebView
    private let field=NSTextField(),hint=NSTextField(labelWithString:"先点远端 QQ 输入框，再在这里用 Mac 输入法；仅粘贴，不发送消息。")
    private let sharing=NSButton(checkboxWithTitle:"⌘C / ⌘V 互通",target:nil,action:nil)
    private let node:String,helper:URL
    private var monitor:Any?,busy=false,closed=false
    init(view:WKWebView,node:String,helper:URL){
        self.view=view;self.node=node;self.helper=helper;super.init()
        field.placeholderString="用 Mac 输入法打中文…";field.setAccessibilityLabel("Mac 中文输入")
        field.target=self;field.action=#selector(insertText);field.font = .systemFont(ofSize:14)
        let insert=NSButton(title:"输入到 QQ",target:self,action:#selector(insertText))
        let paste=NSButton(title:"Mac → QQ",target:self,action:#selector(pasteText))
        let copy=NSButton(title:"QQ → Mac",target:self,action:#selector(copyText))
        insert.toolTip="将已打好的文字粘贴到远端当前输入框，不自动发送"
        paste.toolTip="将 Mac 剪贴板纯文字粘贴到远端（⌘V）"
        copy.toolTip="复制远端选中的文字到 Mac 剪贴板（⌘C）"
        sharing.state=UserDefaults.standard.object(forKey:"QQRemoteClipboardKeys")==nil || UserDefaults.standard.bool(forKey:"QQRemoteClipboardKeys") ? .on:.off
        sharing.target=self;sharing.action=#selector(changeSharing)
        hint.font = .systemFont(ofSize:11);hint.textColor = .secondaryLabelColor
        hint.lineBreakMode = .byTruncatingTail
        let row=NSStackView(views:[NSTextField(labelWithString:"Mac 中文输入"),field,insert,paste,copy]);row.spacing=8;row.alignment = .centerY
        field.setContentHuggingPriority(.defaultLow,for:.horizontal)
        field.setContentCompressionResistancePriority(.defaultLow,for:.horizontal)
        let info=NSStackView(views:[sharing,hint]);info.spacing=12
        let bar=NSStackView(views:[row,info]);bar.orientation = .vertical;bar.alignment = .leading;bar.spacing=7
        root.addSubview(view);root.addSubview(bar);root.remote=view;root.toolbar=bar
        view.autoresizingMask=[.width,.height]
        bar.translatesAutoresizingMaskIntoConstraints=true;bar.autoresizingMask=[.width,.maxYMargin]
        row.widthAnchor.constraint(equalTo:bar.widthAnchor).isActive=true
        root.layout();root.needsLayout=true
        monitor=NSEvent.addLocalMonitorForEvents(matching:.keyDown){[weak self] event in
            guard let self=self,!self.closed,self.sharing.state == .on,event.window===self.view.window,
                let responder=event.window?.firstResponder as? NSView,responder.isDescendant(of:self.view),
                event.modifierFlags.intersection(.deviceIndependentFlagsMask)==[.command] else{return event}
            switch event.charactersIgnoringModifiers?.lowercased(){case "v":self.pasteText();return nil;case "c":self.copyText();return nil;case "a":self.chord("a"){_ in};return nil;default:return event}
        }
    }
    func close(){closed=true;if let monitor=monitor{NSEvent.removeMonitor(monitor)};monitor=nil}
    deinit {if let monitor=monitor{NSEvent.removeMonitor(monitor)}}
    @objc private func changeSharing(){UserDefaults.standard.set(sharing.state == .on,forKey:"QQRemoteClipboardKeys")}
    private func finish(_ message:String){busy=false;if !closed{hint.stringValue=message}}
    @objc private func insertText(){let text=field.stringValue;paste(text){[weak self] in if self?.field.stringValue==text{self?.field.stringValue=""}}}
    @objc private func pasteText(){guard let text=NSPasteboard.general.string(forType:.string) else{hint.stringValue="Mac 剪贴板里没有纯文字，图片和文件请用主聊天界面发送。";return};paste(text)}
    private func paste(_ text:String,done:(()->Void)?=nil){
        guard !busy,!closed else{return}
        guard !text.isEmpty,text.utf8.count<=65536 else{hint.stringValue="请输入不超过64KB的纯文字。";return}
        busy=true;hint.stringValue="正在粘贴中文…"
        transfer("set",text:text){[weak self] result in
            guard let self=self,!self.closed else{return}
            switch result {
            case .failure(let error):self.finish(error.localizedDescription)
            case .success:self.chord("v"){[weak self] error in
                guard let self=self else{return};if let error=error{self.finish(error.localizedDescription)}else{done?();self.finish("已粘贴到远端；请检查内容，再在 QQ 中手动发送。")}
            }
            }
        }
    }
    @objc private func copyText(){
        guard !busy,!closed else{return};busy=true;hint.stringValue="正在复制远端选中文字…"
        chord("c"){[weak self] error in
            guard let self=self,!self.closed else{return}
            if let error=error{self.finish(error.localizedDescription);return}
            DispatchQueue.main.asyncAfter(deadline:.now()+0.2){[weak self] in
                self?.transfer("get"){[weak self] result in
                    guard let self=self,!self.closed else{return}
                    switch result {
                    case .failure(let error):self.finish(error.localizedDescription)
                    case .success(let text):
                        guard !text.isEmpty else{self.finish("远端没有可复制的文字，请先选中文字。");return}
                        NSPasteboard.general.clearContents();NSPasteboard.general.setString(text,forType:.string);self.finish("已复制到 Mac，可以在其他应用中 ⌘V 粘贴。")
                    }
                }
            }
        }
    }
    private func chord(_ key:String,done:@escaping(Error?)->Void){
        // Key only is fixed by this class. Clipboard text is never JavaScript.
        guard ["v","c","a"].contains(key),view.url?.host=="127.0.0.1",view.url?.port==6081 else{done(NSError(domain:"QQInput",code:1,userInfo:[NSLocalizedDescriptionKey:"请先连接 QQ 远程桌面。"]));return}
        view.window?.makeFirstResponder(view)
        view.callAsyncJavaScript("""
        const {default:UI}=await import('/app/ui.js');
        if(!UI.connected||!UI.rfb)throw new Error('QQ 远程桌面尚未连接');
        UI.rfb.focus();
        UI.rfb.sendKey(0xffe7,'MetaLeft',false);UI.rfb.sendKey(0xffe8,'MetaRight',false);
        UI.rfb.sendKey(0xffe3,'ControlLeft',true);
        try{UI.rfb.sendKey(key==='v'?0x76:key==='c'?0x63:0x61,key==='v'?'KeyV':key==='c'?'KeyC':'KeyA');}
        finally{UI.rfb.sendKey(0xffe3,'ControlLeft',false);}
        return true;
        """,arguments:["key":key],in:nil,in:.page){result in switch result{case .success:done(nil);case .failure(let error):
            let detail=(error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String
            done(NSError(domain:"QQInput",code:3,userInfo:[NSLocalizedDescriptionKey:detail ?? "远程桌面尚未连接，请先输入远程桌面密码。 "]))
        }}
    }
    private func transfer(_ operation:String,text:String="",done:@escaping(Result<String,Error>)->Void){
        let node=self.node,helper=self.helper
        DispatchQueue.global(qos:.userInitiated).async{
            let p=Process(),input=Pipe(),output=Pipe();p.executableURL=URL(fileURLWithPath:node);p.arguments=[helper.path,operation];p.standardInput=input;p.standardOutput=output;p.standardError=FileHandle.nullDevice
            let result:Result<String,Error>
            do{
                try p.run();input.fileHandleForWriting.write(Data(text.utf8));try? input.fileHandleForWriting.close()
                let data=output.fileHandleForReading.readDataToEndOfFile();p.waitUntilExit()
                let body=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
                if p.terminationStatus != 0 || body?["ok"] as? Bool != true {throw NSError(domain:"QQInput",code:2,userInfo:[NSLocalizedDescriptionKey:body?["error"] as? String ?? "剪贴板连接暂不可用。"])}
                result = .success(body?["text"] as? String ?? "")
            }catch{result = .failure(error)}
            DispatchQueue.main.async{done(result)}
        }
    }
}
// Official browser login in an isolated UI surface. Cookies go only to the
// existing loopback service, authenticated by its desktop key, never to an LLM.
final class BiliLoginWindow: NSObject, WKHTTPCookieStoreObserver, WKNavigationDelegate {
    private let window:NSWindow
    private let view:WKWebView
    private let connected:([String:Any])->Void
    private var connecting=false
    private var lastSignature=""
    init(connected:@escaping([String:Any])->Void){
        self.connected=connected
        let config=WKWebViewConfiguration();config.websiteDataStore = .default();view=WKWebView(frame:.zero,configuration:config)
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:920,height:720),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
        super.init();window.title="B站官方扫码登录 · 登录后绑定到狐宫静";window.isReleasedWhenClosed=false;window.contentView=view;window.center()
        view.navigationDelegate=self;config.websiteDataStore.httpCookieStore.add(self)
    }
    func show(){window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);view.load(URLRequest(url:URL(string:"https://passport.bilibili.com/login")!))}
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=action.request.url,url.scheme=="https" else {decisionHandler(.cancel);return}
        let allowed=action.targetFrame?.isMainFrame != true || url.host=="bilibili.com" || url.host?.hasSuffix(".bilibili.com")==true
        decisionHandler(allowed ? .allow:.cancel)
    }
    func cookiesDidChange(in cookieStore:WKHTTPCookieStore){
        guard !connecting else{return}
        cookieStore.getAllCookies{[weak self] cookies in
            guard let self=self else{return}
            var values:[String:String]=[:]
            for cookie in cookies where (cookie.domain=="bilibili.com"||cookie.domain.hasSuffix(".bilibili.com"))&&["SESSDATA","bili_jct","DedeUserID","buvid3"].contains(cookie.name){values[cookie.name]=cookie.value}
            guard values["SESSDATA"] != nil,values["bili_jct"] != nil else{return}
            let signature=(values["SESSDATA"] ?? "")+(values["bili_jct"] ?? "")
            guard signature != self.lastSignature else{return};self.connecting=true
            let keyURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CodexRemoteContact/napcat-state/desktop.key")
            guard let key=try? String(contentsOf:keyURL,encoding:.utf8).trimmingCharacters(in:.whitespacesAndNewlines),let data=try? JSONSerialization.data(withJSONObject:["cookies":values]) else {self.connecting=false;return}
            var req=URLRequest(url:URL(string:"http://127.0.0.1:3789/api/life/bili/connect")!);req.httpMethod="POST";req.httpBody=data;req.setValue("application/json",forHTTPHeaderField:"Content-Type");req.setValue(key,forHTTPHeaderField:"x-qq-desktop-key");req.timeoutInterval=20
            URLSession.shared.dataTask(with:req){[weak self] data,response,error in
                DispatchQueue.main.async{guard let self=self else{return};self.connecting=false
                    if let response=response as? HTTPURLResponse,response.statusCode==200,let data=data,let account=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any]{self.lastSignature=signature;self.connected(account);self.window.title="B站已绑定：\(account["name"] ?? "") · \(account["uid"] ?? "")"}
                }
            }.resume()
        }
    }
}
let app=NSApplication.shared
let delegate=DesktopApp()
app.delegate=delegate
app.run()
