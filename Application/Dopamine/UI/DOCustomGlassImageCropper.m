//
//  DOCustomGlassImageCropper.m
//  Dopamine
//

#import "DOCustomGlassImageCropper.h"

@interface DOCustomGlassImageCropper () <UIScrollViewDelegate>
@property (nonatomic, strong) UIImage *sourceImage;
@property (nonatomic, assign) DOCustomGlassCropShape shape;
@property (nonatomic, assign) CGSize aspectSize;
@property (nonatomic, copy) void (^completion)(UIImage *);

@property (nonatomic, strong) UIScrollView *scrollView;
@property (nonatomic, strong) UIImageView *imageView;
@property (nonatomic, strong) UIView *overlayView;
@property (nonatomic, strong) CAShapeLayer *maskLayer;
@property (nonatomic, strong) UIView *frameView;

@property (nonatomic, assign) CGRect cropRect;
@property (nonatomic, assign) BOOL laidOut;
@property (nonatomic, assign) BOOL rendering;
@end

@implementation DOCustomGlassImageCropper

+ (instancetype)cropperWithImage:(UIImage *)image
                           shape:(DOCustomGlassCropShape)shape
                      aspectSize:(CGSize)aspectSize
                      completion:(void (^)(UIImage *))completion
{
    DOCustomGlassImageCropper *cropper = [DOCustomGlassImageCropper new];
    cropper.sourceImage = image;
    cropper.shape = shape;
    cropper.aspectSize = aspectSize;  // CGSizeZero enables the free (largest box) mode
    cropper.completion = completion;
    cropper.modalPresentationStyle = UIModalPresentationFullScreen;
    return cropper;
}

#pragma mark - Lifecycle

- (void)viewDidLoad
{
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.blackColor;

    self.scrollView = [UIScrollView new];
    self.scrollView.translatesAutoresizingMaskIntoConstraints = NO;
    self.scrollView.delegate = self;
    self.scrollView.showsHorizontalScrollIndicator = NO;
    self.scrollView.showsVerticalScrollIndicator = NO;
    self.scrollView.bouncesZoom = YES;
    self.scrollView.decelerationRate = UIScrollViewDecelerationRateFast;
    self.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    [self.view addSubview:self.scrollView];

    self.imageView = [[UIImageView alloc] initWithImage:self.sourceImage];
    self.imageView.contentMode = UIViewContentModeScaleAspectFill;
    self.imageView.userInteractionEnabled = NO;
    [self.scrollView addSubview:self.imageView];

    self.overlayView = [UIView new];
    self.overlayView.translatesAutoresizingMaskIntoConstraints = NO;
    self.overlayView.userInteractionEnabled = NO;
    [self.view addSubview:self.overlayView];

    self.maskLayer = [CAShapeLayer layer];
    self.maskLayer.fillRule = kCAFillRuleEvenOdd;
    self.maskLayer.fillColor = [UIColor colorWithWhite:0.0 alpha:0.62].CGColor;
    [self.overlayView.layer addSublayer:self.maskLayer];

    self.frameView = [UIView new];
    self.frameView.userInteractionEnabled = NO;
    self.frameView.layer.borderColor = UIColor.whiteColor.CGColor;
    self.frameView.layer.borderWidth = 2.0;
    self.frameView.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:self.frameView];

    UIButton *cancel = [UIButton buttonWithType:UIButtonTypeSystem];
    [cancel setTitle:@"取消" forState:UIControlStateNormal];
    cancel.titleLabel.font = [UIFont systemFontOfSize:17 weight:UIFontWeightMedium];
    [cancel addTarget:self action:@selector(cancelTapped) forControlEvents:UIControlEventTouchUpInside];
    cancel.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:cancel];

    UIButton *done = [UIButton buttonWithType:UIButtonTypeSystem];
    [done setTitle:@"完成" forState:UIControlStateNormal];
    done.titleLabel.font = [UIFont systemFontOfSize:17 weight:UIFontWeightSemibold];
    [done addTarget:self action:@selector(doneTapped) forControlEvents:UIControlEventTouchUpInside];
    done.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:done];

    [NSLayoutConstraint activateConstraints:@[
        [self.scrollView.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [self.scrollView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
        [self.scrollView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.scrollView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],

        [self.overlayView.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [self.overlayView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
        [self.overlayView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.overlayView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],

        [cancel.leadingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.leadingAnchor constant:20],
        [cancel.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor constant:-20],
        [done.trailingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.trailingAnchor constant:-20],
        [done.centerYAnchor constraintEqualToAnchor:cancel.centerYAnchor],
    ]];
}

- (void)viewDidLayoutSubviews
{
    [super viewDidLayoutSubviews];
    if (self.laidOut) return;
    CGSize bounds = self.view.bounds.size;
    if (bounds.width < 10 || bounds.height < 10) return;
    self.laidOut = YES;
    [self layoutCropperWithBounds:bounds];
}

- (void)layoutCropperWithBounds:(CGSize)bounds
{
    // Crop frame: fixed aspect when requested, otherwise the largest usable box.
    CGFloat maxWidth = bounds.width - 48.0;
    CGFloat maxHeight = bounds.height - 190.0;
    CGFloat width, height;
    if (self.aspectSize.width <= 0 || self.aspectSize.height <= 0) {
        width = maxWidth;
        height = maxHeight;
    } else {
        CGFloat aspect = self.aspectSize.width / self.aspectSize.height;
        width = maxWidth;
        height = width / aspect;
        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspect;
        }
    }
    self.cropRect = CGRectMake((bounds.width - width) / 2.0,
                               (bounds.height - height) / 2.0 - 20.0,
                               width, height);

    self.frameView.frame = self.cropRect;
    self.frameView.layer.cornerRadius = self.shape == DOCustomGlassCropShapeCircle ?
        MIN(self.cropRect.size.width, self.cropRect.size.height) / 2.0 : 12.0;

    UIBezierPath *path = [UIBezierPath bezierPathWithRect:(CGRect){CGPointZero, bounds}];
    UIBezierPath *hole = self.shape == DOCustomGlassCropShapeCircle ?
        [UIBezierPath bezierPathWithOvalInRect:self.cropRect] :
        [UIBezierPath bezierPathWithRoundedRect:self.cropRect cornerRadius:12.0];
    [path appendPath:hole];
    self.maskLayer.frame = (CGRect){CGPointZero, bounds};
    self.maskLayer.path = path.CGPath;

    // Keep the image view at its natural size; UIScrollView owns all scaling.
    CGSize imageSize = self.sourceImage.size;
    if (imageSize.width <= 0 || imageSize.height <= 0) return;
    self.imageView.frame = CGRectMake(0, 0, imageSize.width, imageSize.height);

    CGFloat scaleX = self.cropRect.size.width / imageSize.width;
    CGFloat scaleY = self.cropRect.size.height / imageSize.height;
    CGFloat minScale = MAX(scaleX, scaleY);

    self.scrollView.contentSize = imageSize;
    self.scrollView.minimumZoomScale = minScale;
    self.scrollView.maximumZoomScale = minScale * 4.0;
    self.scrollView.zoomScale = minScale;
    [self centerContent];
}

#pragma mark - Centering

- (void)centerContent
{
    CGFloat zoom = self.scrollView.zoomScale;
    CGFloat contentWidth = self.scrollView.contentSize.width * zoom;
    CGFloat contentHeight = self.scrollView.contentSize.height * zoom;
    CGFloat insetX = MAX((self.scrollView.bounds.size.width - contentWidth) / 2.0, 0);
    CGFloat insetY = MAX((self.scrollView.bounds.size.height - contentHeight) / 2.0, 0);
    self.scrollView.contentInset = UIEdgeInsetsMake(insetY, insetX, insetY, insetX);
}

- (UIView *)viewForZoomingInScrollView:(UIScrollView *)scrollView
{
    return self.imageView;
}

- (void)scrollViewDidZoom:(UIScrollView *)scrollView
{
    CGFloat zoom = scrollView.zoomScale;
    CGFloat contentWidth = scrollView.contentSize.width * zoom;
    CGFloat contentHeight = scrollView.contentSize.height * zoom;
    CGFloat insetX = MAX((scrollView.bounds.size.width - contentWidth) / 2.0, 0);
    CGFloat insetY = MAX((scrollView.bounds.size.height - contentHeight) / 2.0, 0);
    scrollView.contentInset = UIEdgeInsetsMake(insetY, insetX, insetY, insetX);
}

#pragma mark - Actions

- (void)cancelTapped
{
    if (self.completion) self.completion(nil);
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)doneTapped
{
    if (self.rendering) return;
    self.rendering = YES;
    UIImage *cropped = [self renderCrop];
    if (self.completion) self.completion(cropped);
    [self dismissViewControllerAnimated:YES completion:nil];
}

#pragma mark - Rendering

- (UIImage *)renderCrop
{
    if (!self.sourceImage.CGImage) return self.sourceImage;

    // Crop rect expressed in the scroll view's content space (zoom applied).
    CGRect cropInContent = [self.scrollView convertRect:self.cropRect fromView:self.view];
    CGFloat zoom = MAX(self.scrollView.zoomScale, 0.0001);
    CGRect cropInImage = CGRectMake(
        cropInContent.origin.x / zoom,
        cropInContent.origin.y / zoom,
        cropInContent.size.width / zoom,
        cropInContent.size.height / zoom);

    // imageView.bounds == natural image size (points); convert to CGImage pixels.
    CGSize natural = self.sourceImage.size;
    CGFloat imageW = (CGFloat)CGImageGetWidth(self.sourceImage.CGImage);
    CGFloat imageH = (CGFloat)CGImageGetHeight(self.sourceImage.CGImage);
    CGFloat pixelScaleX = imageW / MAX(natural.width, 1.0);
    CGFloat pixelScaleY = imageH / MAX(natural.height, 1.0);

    CGRect pixelRect = CGRectMake(
        cropInImage.origin.x * pixelScaleX,
        cropInImage.origin.y * pixelScaleY,
        cropInImage.size.width * pixelScaleX,
        cropInImage.size.height * pixelScaleY);
    pixelRect = CGRectIntegral(CGRectIntersection(pixelRect, CGRectMake(0, 0, imageW, imageH)));
    if (CGRectIsEmpty(pixelRect)) return self.sourceImage;

    CGImageRef croppedRef = CGImageCreateWithImageInRect(self.sourceImage.CGImage, pixelRect);
    if (!croppedRef) return self.sourceImage;

    UIImage *cropped = [UIImage imageWithCGImage:croppedRef
                                           scale:self.sourceImage.scale
                                     orientation:self.sourceImage.imageOrientation];
    CGImageRelease(croppedRef);

    // Circle crops are masked to transparency so the avatar frame can breathe.
    if (self.shape != DOCustomGlassCropShapeCircle) return cropped;

    CGFloat side = MIN(cropped.size.width, cropped.size.height);
    UIGraphicsImageRenderer *renderer =
        [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(side, side)];
    return [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
        CGRect rect = CGRectMake(0, 0, side, side);
        [[UIBezierPath bezierPathWithOvalInRect:rect] addClip];
        [cropped drawInRect:rect];
    }];
}

@end
