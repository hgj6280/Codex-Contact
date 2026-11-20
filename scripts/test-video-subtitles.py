"""Offline parser/worker tests, using setup-video-runtime.mjs dependencies."""
import contextlib, io, json, runpy, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

worker=runpy.run_path(str(Path(__file__).resolve().parents[1]/'src/qq-video-worker.py'))

class SubtitleTests(unittest.TestCase):
    def test_short_links_must_resolve_to_same_platform_single_video(self):
        resolve=worker['canonical_short_target']
        self.assertEqual(resolve('https://www.bilibili.com/video/BV1bK411W797/?p=2','bilibili')[1],2)
        self.assertEqual(resolve('https://www.iesdouyin.com/share/video/7495644387297316108/','douyin')[0],'https://www.douyin.com/video/7495644387297316108')
        for url in ['https://space.bilibili.com/123456','https://www.bilibili.com/medialist/play/123456','http://127.0.0.1/video/BV1bK411W797','https://www.youtube.com/watch?v=jNQXAC9IVRw']:
            with self.assertRaises(worker['VideoFailure']):resolve(url,'bilibili')
    def test_bilibili_and_youtube_timestamp_formats(self):
        parse=worker['subtitle_segments']
        self.assertEqual(parse('{"body":[{"from":1.25,"to":3.5,"content":"真实字幕"}]}','json')[0]['start'],1.25)
        self.assertEqual(parse('{"events":[{"tStartMs":1500,"dDurationMs":2000,"segs":[{"utf8":"actual speech"}]}]}','json3')[0]['end'],3.5)
        self.assertEqual(parse('WEBVTT\n\n00:00:01.250 --> 00:00:03.500\n<b>字幕</b>\n','vtt')[0]['text'],'字幕')
        self.assertEqual(parse('1\n00:00:01,250 --> 00:00:03,500\n字幕\n','srt')[0]['start'],1.25)

    def exercise(self,subtitles):
        class FakeYdl:
            def __init__(self,*args):pass
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def extract_info(self,*args,**kwargs):return {'id':'jNQXAC9IVRw','title':'component fixture','duration':20,'subtitles':subtitles}
            @property
            def params(self):return {}
            def process_ie_result(self,*args,**kwargs):raise worker['VideoFailure']('TEST_AUDIO_FALLBACK','fixture reached audio fallback')
        with tempfile.TemporaryDirectory(prefix='qq-video-caption-test-') as directory,patch.object(worker['yt_dlp'],'YoutubeDL',FakeYdl),contextlib.redirect_stdout(io.StringIO()) as output:
            request={'source':{'platform':'youtube','id':'jNQXAC9IVRw','p':1,'url':'https://www.youtube.com/watch?v=jNQXAC9IVRw'},'work':directory,'maxBytes':1000000,'maxDurationSeconds':100,'proxy':'http://127.0.0.1:1'}
            try:result=worker['run'](request)
            except worker['VideoFailure'] as error:result={'error':error.code}
            return result,[json.loads(row) for row in output.getvalue().splitlines()]

    def test_complete_caption_does_not_download_audio(self):
        body=json.dumps({'body':[{'from':0,'to':20,'content':'整段真实字幕'}]})
        result,_=self.exercise({'zh-Hans':[{'ext':'json','data':body}]})
        self.assertEqual(result['mode'],'subtitles');self.assertEqual(result['segments'][0]['end'],20)

    def test_danmaku_is_never_a_caption(self):
        body=json.dumps({'body':[{'from':0,'to':20,'content':'不能当正文的弹幕'}]})
        result,progress=self.exercise({'danmaku':[{'ext':'json','data':body}],'live_chat':[{'ext':'json','data':body}]})
        self.assertEqual(result['error'],'TEST_AUDIO_FALLBACK');self.assertEqual(progress[-1]['subtitleStatus'],'none')

    def test_missing_failed_and_incomplete_captions_are_distinct(self):
        for tracks,state in [({},'none'),({'zh':[{'ext':'json','data':'broken JSON'}]},'fetch_failed'),({'zh':[{'ext':'json','data':'{"body":[{"from":0,"to":1,"content":"片段"}]}'}]},'incomplete')]:
            result,progress=self.exercise(tracks);self.assertEqual(result['error'],'TEST_AUDIO_FALLBACK');self.assertEqual(progress[-1]['subtitleStatus'],state)

if __name__=='__main__':unittest.main()
