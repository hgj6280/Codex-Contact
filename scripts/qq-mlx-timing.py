"""Timestamp tokens within the existing non-streaming MLX worker."""
from functools import wraps
from threading import local
from time import time_ns

from mlx_lm import server


def install():
    timing = local()  # MLX consumes each generator on its HTTP request thread.
    generate = server.ResponseGenerator.generate
    format_response = server.APIHandler.generate_response

    @wraps(generate)
    def measured_generate(self, *args, **kwargs):
        ctx, result = generate(self, *args, **kwargs)
        timing.first = timing.last = None

        def tokens():
            for token in result:
                now = time_ns() // 1_000_000
                if timing.first is None:
                    timing.first = now
                timing.last = now
                yield token

        return ctx, tokens()

    @wraps(format_response)
    def measured_response(self, *args, **kwargs):
        response = format_response(self, *args, **kwargs)
        if not self.stream and 'usage' in response:
            response['local_first_output_at'] = getattr(timing, 'first', None)
            response['local_last_output_at'] = getattr(timing, 'last', None)
        return response

    server.ResponseGenerator.generate = measured_generate
    server.APIHandler.generate_response = measured_response


if __name__ == '__main__':
    install()
    server.main()
