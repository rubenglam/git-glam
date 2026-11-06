fn main() {
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        let attributes = tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new().window_icon_path("icons/icon-dev.ico"),
        );
        tauri_build::try_build(attributes).expect("failed to configure the development icon");
    } else {
        tauri_build::build();
    }
}
