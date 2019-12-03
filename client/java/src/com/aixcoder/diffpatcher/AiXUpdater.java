package com.aixcoder.diffpatcher;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.apache.commons.io.FileUtils;

interface ICancelHandler {
	public void onCancelled(String reason);
}

class CancellationToken {
	boolean cancelled;
	String reason;
	List<ICancelHandler> listeners;

	public CancellationToken() {
		this.listeners = new ArrayList<ICancelHandler>();
		this.cancelled = false;
	}

	public void cancel(String reason) {
		this.reason = reason;
		for (ICancelHandler element : this.listeners) {
			element.onCancelled(reason);
		}
	}

	public void onCancellationRequested(ICancelHandler handler) {
		this.listeners.add(handler);
	}
}

interface ProgressListener {
	void update(long total, int done);
}

abstract class SpeedListener {
	double testSpeed = 0;

	abstract void update(long elapsed, long transferred, long speed);
}

interface ErrorListener {
	void onError(Exception e);
}

interface ConnectionFactory {
	HttpURLConnection getConnection(String urlString) throws IOException;
}

class DefaultConnectionFactory implements ConnectionFactory {

	@Override
	public HttpURLConnection getConnection(String urlString) throws IOException {
		URL url = new URL(urlString);
		HttpURLConnection httpConnection = (HttpURLConnection) (url.openConnection());
		return httpConnection;
	}

}

public class AiXUpdater {

	static ExecutorService pool = Executors.newFixedThreadPool(10);
	static Random random = new Random();

	private static void download(String urlString, String target, ProgressListener listener, SpeedListener onSpeed,
			ConnectionFactory connFactory, CancellationToken token) throws IOException {
		long speedTestStart = 0;
		HttpURLConnection httpConnection = connFactory.getConnection(urlString);
		long completeFileSize = httpConnection.getContentLength();

		java.io.BufferedInputStream in = new java.io.BufferedInputStream(httpConnection.getInputStream());
		if (new File(target).isDirectory()) {
			target += File.separator + urlString.substring(urlString.lastIndexOf("/") + 1);
		}
		java.io.FileOutputStream fos = new java.io.FileOutputStream(target);
		java.io.BufferedOutputStream bout = new BufferedOutputStream(fos, 1024);
		byte[] data = new byte[1024];
		long downloadedFileSize = 0;
		int x = 0;
		speedTestStart = System.currentTimeMillis();
		while ((x = in.read(data, 0, data.length)) >= 0) {
			downloadedFileSize += x;
			if (listener != null) {
				listener.update(completeFileSize, x);
			}
			if (onSpeed != null) {
				long elapsed = Math.max(System.currentTimeMillis() - speedTestStart, 1);
				onSpeed.update(elapsed, downloadedFileSize, downloadedFileSize * 1000 / elapsed);
			}
			bout.write(data, 0, x);
		}
		bout.close();
		in.close();
	}

	static double getDownloadSpeed(String url, ConnectionFactory connFactory,
			final CancellationToken cancellationToken) {
		String tmpPath = "speedtest." + random.nextInt() + ".tmp";
		SpeedListener onSpeed = new SpeedListener() {
			@Override
			public void update(long elapsed, long transferred, long speed) {
				testSpeed = speed;
				if (elapsed > 3000 || transferred > 100 * 1024) {
					cancellationToken.cancel("speedLow");
				}
			}
		};
		try {
			download(url, tmpPath, null, onSpeed, connFactory, cancellationToken);
			return onSpeed.testSpeed;
		} catch (IOException e) {
			e.printStackTrace();
			return -1;
		} finally {
			try {
				FileUtils.deleteDirectory(new File(tmpPath));
			} catch (IOException e) {
				e.printStackTrace();
			}
		}
	}

	static String selectBestMirror(List<String> urlList, final CancellationToken token) {
		return selectBestMirror(urlList, new DefaultConnectionFactory(), token);
	}

	static String selectBestMirror(List<String> urlList, final ConnectionFactory connFactory, final CancellationToken token) {
		if (urlList.size() == 1) {
			return urlList.get(0);
		}
		ArrayList<Callable<Double>> tasks = new ArrayList<Callable<Double>>();
		for (final String url : urlList) {
			tasks.add(new Callable<Double>() {

				@Override
				public Double call() {
					return getDownloadSpeed(url, connFactory, token);
				}

			});
		}
		try {
			List<Future<Double>> futures = pool.invokeAll(tasks);
			int bestI = 0;
			for (int i = 0; i < futures.size(); i++) {
				if (futures.get(i).get() > futures.get(bestI).get()) {
					bestI = i;
				}
			}
			return futures.get(bestI).get() > 0 ? urlList.get(bestI) : null;
		} catch (InterruptedException e) {
			e.printStackTrace();
		} catch (ExecutionException e) {
			e.printStackTrace();
		}
		return null;
	}
}
