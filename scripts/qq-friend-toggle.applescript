on run
    try
        set nodePath to (POSIX path of (path to home folder)) & ".nvm/versions/node/v24.15.0/bin/node"
        set togglePath to (POSIX path of (path to me)) & "Contents/Resources/qq-friend-toggle.mjs"
        set resultText to do shell script (quoted form of nodePath & " " & quoted form of togglePath)
        activate
        set choice to display dialog resultText with title "QQ 群友开关" buttons {"打开控制面板", "好"} default button "好"
        if button returned of choice is "打开控制面板" then
            open location "http://127.0.0.1:3789/"
        end if
    on error errorText
        activate
        display dialog ("未能切换 QQ 群友：" & return & errorText) with title "QQ 群友开关" buttons {"好"} default button "好" with icon caution
    end try
end run
